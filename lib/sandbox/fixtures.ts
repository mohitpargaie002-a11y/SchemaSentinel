/**
 * SchemaSentinel — Realistic PostgreSQL Fixtures
 * Baseline ecommerce schema with relationships, constraints, indexes, and seed records.
 */

export const BASELINE_ECOMMERCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(128) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku VARCHAR(64) NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
`;

export const BASELINE_SEED_DATA = `
INSERT INTO users (email, full_name) VALUES
  ('alice@example.com', 'Alice Smith'),
  ('bob@example.com', 'Bob Jones'),
  ('carol@example.com', 'Carol Williams')
ON CONFLICT (email) DO NOTHING;

INSERT INTO orders (user_id, total_amount, currency) VALUES
  (1, 149.99, 'USD'),
  (1, 29.50, 'USD'),
  (2, 499.00, 'USD'),
  (3, 85.20, 'USD');

INSERT INTO order_items (order_id, sku, quantity, unit_price) VALUES
  (1, 'PROD-A1', 1, 149.99),
  (2, 'PROD-B2', 2, 14.75),
  (3, 'PROD-C3', 1, 499.00),
  (4, 'PROD-D4', 4, 21.30);
`;

export const SAMPLE_REPRESENTATIVE_QUERIES = [
  "SELECT o.id, u.email, o.total_amount FROM orders o JOIN users u ON o.user_id = u.id WHERE o.total_amount > 50;",
  "SELECT order_id, SUM(quantity * unit_price) as computed_total FROM order_items GROUP BY order_id;",
];
