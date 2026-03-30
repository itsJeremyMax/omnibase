import { describe, it, expect, vi } from "vitest";
import { handleValidateQuery } from "../../src/tools/validate-query.js";
import { ConnectionManager } from "../../src/connection-manager.js";
import type { OmnibaseConfig, QueryResult } from "../../src/types.js";

const config: OmnibaseConfig = {
  connections: {
    readonly: {
      name: "readonly",
      dsn: "sqlite::memory:",
      permission: "read-only",
      timeout: 5000,
      maxRows: 100,
    },
    readwrite: {
      name: "readwrite",
      dsn: "sqlite::memory:",
      permission: "read-write",
      timeout: 5000,
      maxRows: 100,
    },
    admin: {
      name: "admin",
      dsn: "sqlite::memory:",
      permission: "admin",
      timeout: 5000,
      maxRows: 100,
    },
  },
  defaults: { permission: "read-only", timeout: 30000, maxRows: 500 },
};

const mockSchema = {
  tables: [
    {
      name: "users",
      schema: "main",
      columns: [
        {
          name: "id",
          type: "INT",
          nullable: false,
          defaultValue: null,
          isPrimaryKey: true,
          comment: null,
        },
        {
          name: "name",
          type: "TEXT",
          nullable: true,
          defaultValue: null,
          isPrimaryKey: false,
          comment: null,
        },
        {
          name: "role",
          type: "TEXT",
          nullable: true,
          defaultValue: null,
          isPrimaryKey: false,
          comment: null,
        },
      ],
      primaryKey: ["id"],
      indexes: [],
      foreignKeys: [],
      rowCountEstimate: 10,
      exactCount: false,
      comment: null,
    },
  ],
};

function makeCm(countResult?: number) {
  const backend = {
    connect: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue({
      columns: ["count(*)"],
      rows: [[countResult ?? 0]],
      rowCount: 1,
      hasMore: false,
    } satisfies QueryResult),
    getSchema: vi.fn().mockResolvedValue(mockSchema),
    validateQuery: vi.fn().mockResolvedValue({ valid: false, error: "mock rejection" }),
    ping: vi.fn(),
    disconnect: vi.fn(),
  };
  return new ConnectionManager(backend);
}

function makeCmWithDbValidation(dbValid: boolean, countResult?: number) {
  const backend = {
    connect: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue({
      columns: ["count(*)"],
      rows: [[countResult ?? 0]],
      rowCount: 1,
      hasMore: false,
    } satisfies QueryResult),
    getSchema: vi.fn().mockResolvedValue(mockSchema),
    validateQuery: vi
      .fn()
      .mockResolvedValue(
        dbValid ? { valid: true } : { valid: false, error: "no such table: fake" },
      ),
    ping: vi.fn(),
    disconnect: vi.fn(),
  };
  return new ConnectionManager(backend);
}

describe("handleValidateQuery", () => {
  it("validates a correct SELECT", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "readonly",
      query: "SELECT * FROM users",
    });
    expect(result.syntax_valid).toBe(true);
    expect(result.category).toBe("read");
    expect(result.would_be_allowed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects INSERT on read-only connection", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "readonly",
      query: "INSERT INTO users VALUES (1)",
    });
    expect(result.category).toBe("write");
    expect(result.would_be_allowed).toBe(false);
    expect(result.errors.some((e: string) => e.includes("read-only"))).toBe(true);
  });

  it("allows INSERT on read-write connection", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "readwrite",
      query: "INSERT INTO users VALUES (1)",
    });
    expect(result.would_be_allowed).toBe(true);
  });

  it("rejects DDL on read-write connection", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "readwrite",
      query: "DROP TABLE users",
    });
    expect(result.category).toBe("ddl");
    expect(result.would_be_allowed).toBe(false);
  });

  it("allows DDL on admin connection", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "admin",
      query: "CREATE TABLE t (id INT)",
    });
    expect(result.would_be_allowed).toBe(true);
  });

  it("flags multi-statement queries", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "admin",
      query: "SELECT 1; DROP TABLE users",
    });
    expect(result.multi_statement).toBe(true);
    expect(result.would_be_allowed).toBe(false);
  });

  it("validates parameterized queries with ? placeholders", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "readonly",
      query: "SELECT * FROM users WHERE id = ? AND name = ?",
    });
    expect(result.syntax_valid).toBe(true);
    expect(result.category).toBe("read");
  });

  it("detects syntax errors and does not assign category", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "readonly",
      query: "SELEC * FORM users",
    });
    expect(result.syntax_valid).toBe(false);
    expect(result.category).toBeNull();
    expect(result.would_be_allowed).toBe(false);
    expect(result.errors.some((e: string) => e.includes("Syntax error"))).toBe(true);
  });

  it("throws on unknown connection", async () => {
    const cm = makeCm();
    await expect(
      handleValidateQuery(config, cm, { connection: "nope", query: "SELECT 1" }),
    ).rejects.toThrow("Unknown connection");
  });

  // Database fallback tests
  it("falls back to database PREPARE when parser rejects valid DB-specific syntax", async () => {
    const cm = makeCmWithDbValidation(true);
    const result = await handleValidateQuery(config, cm, {
      connection: "readwrite",
      query: "INSERT OR REPLACE INTO users (id, name) VALUES (1, 'test')",
    });
    // Parser rejects INSERT OR REPLACE, but database says it's valid
    expect(result.syntax_valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports invalid when both parser and database reject", async () => {
    const cm = makeCmWithDbValidation(false);
    const result = await handleValidateQuery(config, cm, {
      connection: "readonly",
      query: "SELEC * FORM users",
    });
    expect(result.syntax_valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("no such table"))).toBe(true);
  });

  it("database fallback catches schema errors the parser misses", async () => {
    const cm = makeCmWithDbValidation(false);
    const result = await handleValidateQuery(config, cm, {
      connection: "readonly",
      query: "INSERT OR IGNORE INTO nonexistent (id) VALUES (1)",
    });
    expect(result.syntax_valid).toBe(false);
  });

  // Row estimate tests
  it("estimates affected rows for UPDATE with WHERE", async () => {
    const cm = makeCm(42);
    const result = await handleValidateQuery(config, cm, {
      connection: "readwrite",
      query: "UPDATE users SET name = 'test' WHERE role = 'admin'",
    });
    expect(result.estimated_rows_affected).toBe(42);
  });

  it("estimates affected rows for DELETE with WHERE", async () => {
    const cm = makeCm(10);
    const result = await handleValidateQuery(config, cm, {
      connection: "readwrite",
      query: "DELETE FROM users WHERE id > 5",
    });
    expect(result.estimated_rows_affected).toBe(10);
  });

  it("estimates affected rows for UPDATE without WHERE (all rows)", async () => {
    const cm = makeCm(500);
    const result = await handleValidateQuery(config, cm, {
      connection: "readwrite",
      query: "UPDATE users SET active = true",
    });
    expect(result.estimated_rows_affected).toBe(500);
  });

  it("does not estimate rows for SELECT queries", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "readonly",
      query: "SELECT * FROM users",
    });
    expect(result.estimated_rows_affected).toBeUndefined();
  });

  // Schema validation tests
  it("detects nonexistent table", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "readonly",
      query: "SELECT * FROM nonexistent_table",
    });
    expect(result.syntax_valid).toBe(true);
    expect(result.schema_valid).toBe(false);
    expect(result.warnings.some((w: string) => w.includes("nonexistent_table"))).toBe(true);
  });

  it("detects nonexistent column on single-table query", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "readonly",
      query: "SELECT nonexistent_col FROM users",
    });
    expect(result.syntax_valid).toBe(true);
    expect(result.schema_valid).toBe(false);
    expect(result.warnings.some((w: string) => w.includes("nonexistent_col"))).toBe(true);
  });

  it("passes schema validation for valid table and columns", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "readonly",
      query: "SELECT id, name FROM users",
    });
    expect(result.syntax_valid).toBe(true);
    expect(result.schema_valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("detects nonexistent column via table alias", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "readonly",
      query: "SELECT u.fake_column FROM users u",
    });
    expect(result.syntax_valid).toBe(true);
    expect(result.schema_valid).toBe(false);
    expect(result.warnings.some((w: string) => w.includes("fake_column"))).toBe(true);
  });

  it("passes schema validation for valid aliased column", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "readonly",
      query: "SELECT u.name FROM users u WHERE u.id = 1",
    });
    expect(result.syntax_valid).toBe(true);
    expect(result.schema_valid).toBe(true);
  });

  it("schema_valid is null when syntax is invalid", async () => {
    const cm = makeCm();
    const result = await handleValidateQuery(config, cm, {
      connection: "readonly",
      query: "SELEC * FORM users",
    });
    expect(result.syntax_valid).toBe(false);
    expect(result.schema_valid).toBeNull();
  });
});
