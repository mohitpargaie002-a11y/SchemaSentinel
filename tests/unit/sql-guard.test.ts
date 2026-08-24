import { describe, it, expect } from "vitest";
import { assertReadOnlySql, SqlGuardViolationError } from "../../lib/safety/sql-guard.js";

describe("SqlGuard - Readonly Safety Enforcement", () => {
  it("allows safe SELECT and EXPLAIN queries", () => {
    expect(() => assertReadOnlySql("SELECT id, email FROM users WHERE id = 1")).not.toThrow();
    expect(() => assertReadOnlySql("EXPLAIN ANALYZE SELECT * FROM orders")).not.toThrow();
    expect(() => assertReadOnlySql("SHOW server_version")).not.toThrow();
  });

  it("rejects DDL mutations", () => {
    expect(() => assertReadOnlySql("ALTER TABLE orders ADD COLUMN status VARCHAR(32)")).toThrow(
      SqlGuardViolationError
    );
    expect(() => assertReadOnlySql("DROP TABLE users")).toThrow(SqlGuardViolationError);
    expect(() => assertReadOnlySql("TRUNCATE TABLE payments")).toThrow(SqlGuardViolationError);
    expect(() => assertReadOnlySql("CREATE TABLE test (id INT)")).toThrow(SqlGuardViolationError);
  });

  it("rejects DML mutations", () => {
    expect(() => assertReadOnlySql("INSERT INTO users (email) VALUES ('test@example.com')")).toThrow(
      SqlGuardViolationError
    );
    expect(() => assertReadOnlySql("UPDATE users SET email = 'admin@example.com'")).toThrow(
      SqlGuardViolationError
    );
    expect(() => assertReadOnlySql("DELETE FROM orders WHERE id = 10")).toThrow(
      SqlGuardViolationError
    );
  });

  it("rejects multi-statement injection containing destructive queries", () => {
    expect(() =>
      assertReadOnlySql("SELECT 1; DROP TABLE users; SELECT 2;")
    ).toThrow(SqlGuardViolationError);
  });
});
