-- Migration: 0039_add_user_index.sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email);
