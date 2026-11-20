ALTER TABLE products ADD COLUMN personal_note TEXT NOT NULL DEFAULT '';

ALTER TABLE movements ADD COLUMN reason TEXT CHECK(reason IN ('damaged','missing','miscount','other'));
