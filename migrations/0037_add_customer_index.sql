-- Migration: 0037_add_customer_index.sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_email ON users(email);
