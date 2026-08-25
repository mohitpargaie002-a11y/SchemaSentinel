-- SchemaSentinel Candidate Migration
-- Adds status column to orders table and creates index

ALTER TABLE orders ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending';
CREATE INDEX idx_orders_status ON orders(status);
