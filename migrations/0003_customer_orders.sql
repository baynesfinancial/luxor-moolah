CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  phone_digits TEXT UNIQUE,
  email TEXT COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX customer_name ON customers(name COLLATE NOCASE);

CREATE TABLE orders (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  sold_on TEXT NOT NULL,
  closed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX orders_by_customer ON orders(customer_id,sold_on DESC);
CREATE INDEX orders_by_date ON orders(sold_on DESC,id);

ALTER TABLE sales ADD COLUMN order_id TEXT REFERENCES orders(id);
CREATE INDEX sales_by_order ON sales(order_id);
