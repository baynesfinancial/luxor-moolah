CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('employee','manager')), active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE categories (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('audience','type')),
  name TEXT NOT NULL COLLATE NOCASE, UNIQUE(kind,name)
);
INSERT INTO categories(kind,name) VALUES
 ('audience','Men'),('audience','Women'),('audience','Boys'),('audience','Girls'),
 ('type','Mugs'),('type','Gift Sets'),('type','Fragrances'),('type','Stationery & Journals'),
 ('type','Toys'),('type','Household Items'),('type','Accessories'),('type','Makeup');

CREATE TABLE products (
  sku TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  type_id INTEGER REFERENCES categories(id), price INTEGER CHECK(price>=0),
  sale_price INTEGER CHECK(sale_price>=0), discount INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','active','archived')),
  published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE product_categories (
  sku TEXT REFERENCES products(sku), category_id INTEGER REFERENCES categories(id), PRIMARY KEY(sku,category_id)
);
CREATE TABLE batches (
  id TEXT PRIMARY KEY, sku TEXT NOT NULL REFERENCES products(sku),
  received_on TEXT, cost INTEGER CHECK(cost>=0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE sales (
  id TEXT PRIMARY KEY, sku TEXT NOT NULL REFERENCES products(sku), quantity INTEGER NOT NULL CHECK(quantity>0),
  sold_on TEXT NOT NULL, unit_price INTEGER CHECK(unit_price>=0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','canceled')),
  submitted_by TEXT NOT NULL REFERENCES users(id), reviewed_by TEXT REFERENCES users(id),
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT
);
CREATE TABLE sale_notes (
  id TEXT PRIMARY KEY, sale_id TEXT REFERENCES sales(id), actor TEXT REFERENCES users(id),
  note TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE movements (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id),
  kind TEXT NOT NULL CHECK(kind IN ('receive','sale','return','damage','adjust')),
  qty INTEGER NOT NULL, effective_on TEXT NOT NULL, sale_id TEXT REFERENCES sales(id),
  actor TEXT REFERENCES users(id), note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX movements_batch ON movements(batch_id);
CREATE INDEX movements_date ON movements(effective_on);
CREATE INDEX sales_sku_status ON sales(sku,status);
CREATE INDEX sales_date ON sales(sold_on,status);

CREATE TABLE issues (
  id TEXT PRIMARY KEY, sku TEXT NOT NULL REFERENCES products(sku), note TEXT NOT NULL,
  submitted_by TEXT REFERENCES users(id), resolution TEXT, resolved_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT
);
CREATE TABLE photos (
  id TEXT PRIMARY KEY, sku TEXT REFERENCES products(sku), issue_id TEXT REFERENCES issues(id),
  uploader TEXT NOT NULL REFERENCES users(id), mime TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX photos_sku ON photos(sku);
CREATE TABLE events (
  sku TEXT NOT NULL REFERENCES products(sku), day TEXT NOT NULL, kind TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(sku,day,kind)
);
CREATE TABLE recent (
  user_id TEXT REFERENCES users(id), sku TEXT REFERENCES products(sku), seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,sku)
);
CREATE TABLE import_rows (
  id TEXT PRIMARY KEY, importer TEXT REFERENCES users(id), payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, approved_at TEXT
);
CREATE TABLE returns (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id),
  returned_on TEXT NOT NULL, restock INTEGER NOT NULL, reason TEXT NOT NULL, actor TEXT REFERENCES users(id),
  quantity INTEGER NOT NULL CHECK(quantity>0), refund INTEGER NOT NULL CHECK(refund>=0)
);
CREATE INDEX return_sale ON returns(sale_id);
CREATE TABLE return_allocations (
  return_id TEXT REFERENCES returns(id), movement_id TEXT REFERENCES movements(id),
  quantity INTEGER NOT NULL CHECK(quantity>0), PRIMARY KEY(return_id,movement_id)
);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY, actor TEXT REFERENCES users(id), action TEXT NOT NULL, target TEXT NOT NULL,
  details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE VIEW batch_balances AS
 SELECT b.*,COALESCE(SUM(m.qty),0) AS on_hand
 FROM batches b LEFT JOIN movements m ON m.batch_id=b.id GROUP BY b.id;
CREATE VIEW stock AS
 SELECT p.sku,
 COALESCE((SELECT SUM(b.on_hand) FROM batch_balances b WHERE b.sku=p.sku),0) AS on_hand,
 COALESCE((SELECT SUM(s.quantity) FROM sales s WHERE s.sku=p.sku AND s.status='pending'),0) AS reserved
 FROM products p;

CREATE TRIGGER reserve_sale BEFORE INSERT ON sales
WHEN NEW.status='pending' AND NEW.quantity > COALESCE(
 (SELECT on_hand-reserved FROM stock WHERE sku=NEW.sku),0)
BEGIN SELECT RAISE(ABORT,'Insufficient available stock'); END;

CREATE TRIGGER verify_sale_update BEFORE UPDATE ON sales WHEN OLD.status='pending' AND NEW.status IN ('pending','approved')
BEGIN
 SELECT CASE WHEN NEW.quantity > COALESCE((SELECT on_hand-reserved FROM stock WHERE sku=NEW.sku),0)
    + CASE WHEN NEW.sku=OLD.sku THEN OLD.quantity ELSE 0 END
  THEN RAISE(ABORT,'Insufficient available stock') END;
 SELECT CASE WHEN NEW.status='approved' AND NEW.unit_price IS NULL
  THEN RAISE(ABORT,'Enter the actual selling price') END;
END;

CREATE TRIGGER approve_sale AFTER UPDATE ON sales WHEN OLD.status='pending' AND NEW.status='approved'
BEGIN
 INSERT INTO movements(id,batch_id,kind,qty,effective_on,sale_id,actor)
 SELECT NEW.id||':'||id,id,'sale',-MIN(on_hand,NEW.quantity-prior_units),NEW.sold_on,NEW.id,NEW.reviewed_by
 FROM (
  SELECT id,on_hand,COALESCE(SUM(on_hand) OVER(ORDER BY received_on IS NULL, received_on, created_at,id
   ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior_units
  FROM batch_balances WHERE sku=NEW.sku AND on_hand>0
 ) WHERE prior_units<NEW.quantity;
END;

CREATE TRIGGER verify_return BEFORE INSERT ON returns
BEGIN
 SELECT CASE WHEN NEW.quantity > COALESCE((SELECT s.quantity FROM sales s WHERE s.id=NEW.sale_id AND s.status='approved'),0)
   - COALESCE((SELECT SUM(r.quantity) FROM returns r WHERE r.sale_id=NEW.sale_id),0)
  THEN RAISE(ABORT,'Return exceeds the remaining sold quantity') END;
END;

CREATE TRIGGER apply_return AFTER INSERT ON returns
BEGIN
 INSERT INTO return_allocations(return_id,movement_id,quantity)
 SELECT NEW.id,id,MIN(available,NEW.quantity-prior_units)
 FROM (
  SELECT id,available,COALESCE(SUM(available) OVER(ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior_units
  FROM (
   SELECT m.id,-m.qty-COALESCE((SELECT SUM(a.quantity) FROM return_allocations a WHERE a.movement_id=m.id),0) AS available
   FROM movements m WHERE m.sale_id=NEW.sale_id AND m.kind='sale'
  ) WHERE available>0
 ) WHERE prior_units<NEW.quantity;
 INSERT INTO movements(id,batch_id,kind,qty,effective_on,sale_id,actor,note)
 SELECT NEW.id||':'||m.batch_id,m.batch_id,'return',a.quantity,NEW.returned_on,NEW.sale_id,NEW.actor,NEW.reason
 FROM return_allocations a JOIN movements m ON m.id=a.movement_id WHERE a.return_id=NEW.id AND NEW.restock=1;
END;

CREATE TRIGGER prevent_negative_stock BEFORE INSERT ON movements WHEN NEW.qty<0
BEGIN
 SELECT CASE WHEN -NEW.qty > COALESCE((SELECT on_hand FROM batch_balances WHERE id=NEW.batch_id),0)
  THEN RAISE(ABORT,'Insufficient batch stock') END;
 SELECT CASE WHEN NEW.kind<>'sale' AND -NEW.qty > COALESCE(
  (SELECT on_hand-reserved FROM stock WHERE sku=(SELECT sku FROM batches WHERE id=NEW.batch_id)),0)
  THEN RAISE(ABORT,'Reserved stock cannot be removed') END;
END;
CREATE TABLE applied_imports (id TEXT PRIMARY KEY REFERENCES import_rows(id));
