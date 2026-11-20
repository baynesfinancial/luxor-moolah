ALTER TABLE products ADD COLUMN clearance_started_at TEXT;

ALTER TABLE featured_products RENAME TO previous_featured_products;
CREATE TABLE featured_products (
  slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 1 AND 5),
  sku TEXT NOT NULL UNIQUE REFERENCES products(sku) ON DELETE CASCADE
);
INSERT INTO featured_products SELECT slot,sku FROM previous_featured_products;
DROP TABLE previous_featured_products;

UPDATE products SET clearance_started_at=COALESCE((
  SELECT MIN(a.created_at) FROM audit a
  WHERE a.target=products.sku AND a.action='product.clearance.set'
    AND a.id>COALESCE((SELECT MAX(e.id) FROM audit e
      WHERE e.target=products.sku AND e.action='product.clearance.end'),0)
),CURRENT_TIMESTAMP)
WHERE discount=1 AND sale_price<price;

CREATE TABLE homepage_pins (
  section TEXT NOT NULL CHECK(section IN ('arrivals','clearance')),
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND CASE section WHEN 'arrivals' THEN 4 ELSE 3 END),
  sku TEXT NOT NULL UNIQUE REFERENCES products(sku) ON DELETE CASCADE,
  PRIMARY KEY(section,slot)
);

CREATE TABLE homepage_sold_out (
  section TEXT NOT NULL,
  slot INTEGER NOT NULL,
  sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
  PRIMARY KEY(section,slot)
);

CREATE TRIGGER drop_pins_for_sold_stock AFTER INSERT ON movements
WHEN NEW.qty<0
BEGIN
  INSERT OR REPLACE INTO homepage_sold_out(section,slot,sku)
  SELECT section,slot,p.sku FROM (
    SELECT section,slot,sku FROM homepage_pins
    UNION ALL SELECT 'featured',slot,sku FROM featured_products
  ) p JOIN stock s ON s.sku=p.sku JOIN batches b ON b.sku=p.sku
  WHERE NEW.kind='sale' AND b.id=NEW.batch_id AND s.on_hand<=0;
  DELETE FROM homepage_pins WHERE sku=(
    SELECT b.sku FROM batches b JOIN stock s ON s.sku=b.sku
    WHERE b.id=NEW.batch_id AND s.on_hand<=0
  );
  DELETE FROM featured_products WHERE NEW.kind='sale' AND sku=(
    SELECT b.sku FROM batches b JOIN stock s ON s.sku=b.sku
    WHERE b.id=NEW.batch_id AND s.on_hand<=0
  );
END;

CREATE TRIGGER drop_pins_for_listing_change AFTER UPDATE OF state,discount ON products
BEGIN
  DELETE FROM homepage_pins WHERE sku=NEW.sku AND
    (NEW.state<>'active' OR (section='clearance' AND NEW.discount<>1));
END;
