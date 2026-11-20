CREATE TABLE product_themes (
  sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
  theme_key TEXT NOT NULL,
  theme TEXT NOT NULL,
  PRIMARY KEY (sku,theme_key)
);
