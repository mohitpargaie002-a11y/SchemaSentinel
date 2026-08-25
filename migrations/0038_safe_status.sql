-- Safe migration test
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(32);