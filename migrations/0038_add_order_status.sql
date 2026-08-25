-- Step 1: Add column nullable without locking table rewrite
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(32);

-- Step 2: Backfill default values for existing rows (Note: For high-volume tables >100k rows, partition in batches)
UPDATE orders SET status = 'pending' WHERE status IS NULL;

-- Step 3: Set column default for future write operations
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending';

-- Step 4: Enforce NOT NULL invariant
ALTER TABLE orders ALTER COLUMN status SET NOT NULL;

-- Step: Build index concurrently to prevent table write blocking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status ON orders(status);