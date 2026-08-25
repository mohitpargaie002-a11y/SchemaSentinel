import { describe, it, expect } from "vitest";
import { SqlValidator } from "../../lib/agent/safe-migration-generator.js";

describe("SqlValidator Unit Tests", () => {
  const validator = new SqlValidator();

  it("passes safe staged SQL statements", () => {
    const safeSql = `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
      UPDATE users SET phone = '+1-000-000-0000' WHERE phone IS NULL;
      ALTER TABLE users ALTER COLUMN phone SET DEFAULT '+1-000-000-0000';
      ALTER TABLE users ALTER COLUMN phone SET NOT NULL;
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_phone ON users(phone);
    `;

    const result = validator.validateSyntaxAndSafety(safeSql, { strictConcurrent: true, disallowUnsafeNotNull: true });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("flags non-concurrent index creation when strictConcurrent is enabled", () => {
    const unsafeIndexSql = `CREATE INDEX idx_users_phone ON users(phone);`;
    const result = validator.validateSyntaxAndSafety(unsafeIndexSql, { strictConcurrent: true });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("CONCURRENTLY"))).toBe(true);
  });

  it("flags atomic ADD COLUMN NOT NULL without separate backfill", () => {
    const unsafeSql = `ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;`;
    const result = validator.validateSyntaxAndSafety(unsafeSql, { disallowUnsafeNotNull: true });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("NOT NULL"))).toBe(true);
  });

  it("blocks dangerous statements like DROP DATABASE and TRUNCATE", () => {
    const dangerousDrop = `DROP DATABASE production;`;
    const result = validator.validateSyntaxAndSafety(dangerousDrop);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Forbidden"))).toBe(true);
  });
});
