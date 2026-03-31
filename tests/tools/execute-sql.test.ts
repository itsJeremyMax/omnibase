// tests/tools/execute-sql.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleExecuteSql, checkSqlSecurity } from "../../src/tools/execute-sql.js";
import { ConnectionManager } from "../../src/connection-manager.js";
import type { OmnibaseConfig, DatabaseBackend, QueryResult } from "../../src/types.js";

function makeConfig(): OmnibaseConfig {
  return {
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
    },
    defaults: { permission: "read-only", timeout: 30000, maxRows: 500 },
  };
}

function makeMockBackend(): DatabaseBackend {
  return {
    connect: vi.fn().mockResolvedValue({ driver: "" }),
    execute: vi.fn().mockResolvedValue({
      columns: ["id"],
      rows: [[1]],
      rowCount: 1,
      hasMore: false,
    } satisfies QueryResult),
    getSchema: vi.fn().mockResolvedValue({ tables: [] }),
    ping: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

describe("handleExecuteSql", () => {
  it("allows SELECT on read-only connection", async () => {
    const backend = makeMockBackend();
    const cm = new ConnectionManager(backend);
    const config = makeConfig();

    const result = await handleExecuteSql(config, cm, {
      connection: "readonly",
      query: "SELECT * FROM users",
    });
    expect(result.row_count).toBe(1);
  });

  it("rejects INSERT on read-only connection", async () => {
    const backend = makeMockBackend();
    const cm = new ConnectionManager(backend);
    const config = makeConfig();

    await expect(
      handleExecuteSql(config, cm, {
        connection: "readonly",
        query: "INSERT INTO users VALUES (1)",
      }),
    ).rejects.toThrow("read-only");
  });

  it("rejects multi-statement queries", async () => {
    const backend = makeMockBackend();
    const cm = new ConnectionManager(backend);
    const config = makeConfig();

    await expect(
      handleExecuteSql(config, cm, {
        connection: "readwrite",
        query: "SELECT 1; DROP TABLE users",
      }),
    ).rejects.toThrow("Multi-statement");
  });

  it("throws on unknown connection", async () => {
    const backend = makeMockBackend();
    const cm = new ConnectionManager(backend);
    const config = makeConfig();

    await expect(
      handleExecuteSql(config, cm, {
        connection: "nonexistent",
        query: "SELECT 1",
      }),
    ).rejects.toThrow("Unknown connection");
  });

  it("respects limit param to override maxRows", async () => {
    const backend = makeMockBackend();
    const cm = new ConnectionManager(backend);
    const config = makeConfig();

    await handleExecuteSql(config, cm, {
      connection: "readwrite",
      query: "SELECT * FROM users",
      limit: 2,
    });
    // limit=2 should be passed as maxRows in the execute options
    expect(backend.execute).toHaveBeenCalledWith(
      "readwrite",
      "SELECT * FROM users",
      undefined,
      expect.objectContaining({ maxRows: 2 }),
    );
  });

  it("applies offset by skipping rows", async () => {
    const backend = makeMockBackend();
    (backend.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      columns: ["id"],
      rows: [[1], [2], [3], [4], [5]],
      rowCount: 5,
      hasMore: false,
    });
    const cm = new ConnectionManager(backend);
    const config = makeConfig();

    const result = await handleExecuteSql(config, cm, {
      connection: "readwrite",
      query: "SELECT * FROM users",
      limit: 2,
      offset: 2,
    });
    // Should skip first 2 rows and return next 2
    expect(result.rows).toEqual([[3], [4]]);
    expect(result.row_count).toBe(2);
    expect(result.page_offset).toBe(2);
  });

  it("audit log receives pre-slice row count when offset is used", async () => {
    const backend = makeMockBackend();
    (backend.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      columns: ["id"],
      rows: [[1], [2], [3], [4], [5]],
      rowCount: 5,
      hasMore: false,
    });
    const cm = new ConnectionManager(backend);
    const config = makeConfig();
    const mockAuditLogger = { log: vi.fn() };

    const result = await handleExecuteSql(
      config,
      cm,
      { connection: "readwrite", query: "SELECT * FROM users", limit: 2, offset: 2 },
      mockAuditLogger as any,
    );
    // Returned result should have 2 rows (after slicing)
    expect(result.row_count).toBe(2);
    // Audit log should have the pre-slice count (5 rows fetched)
    expect(mockAuditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ rows: 5, status: "ok" }),
    );
  });

  it("fetches offset + limit rows from backend", async () => {
    const backend = makeMockBackend();
    const cm = new ConnectionManager(backend);
    const config = makeConfig();

    await handleExecuteSql(config, cm, {
      connection: "readwrite",
      query: "SELECT * FROM users",
      limit: 10,
      offset: 20,
    });
    // Should fetch 30 rows (20 + 10) from backend
    expect(backend.execute).toHaveBeenCalledWith(
      "readwrite",
      "SELECT * FROM users",
      undefined,
      expect.objectContaining({ maxRows: 30 }),
    );
  });
});

describe("checkSqlSecurity", () => {
  const connConfig = {
    name: "test-db",
    dsn: "sqlite::memory:",
    permission: "read-write" as const,
    timeout: 5000,
    maxRows: 100,
  };

  it("throws on dangerous function", () => {
    expect(() => checkSqlSecurity("SELECT pg_read_file('/etc/passwd')", connConfig)).toThrow(
      "not allowed",
    );
  });

  it("throws on sensitive table", () => {
    expect(() => checkSqlSecurity("SELECT * FROM pg_shadow", connConfig)).toThrow("not allowed");
  });

  it("throws on ATTACH", () => {
    expect(() => checkSqlSecurity("ATTACH DATABASE '/tmp/x' AS x", connConfig)).toThrow(
      "not allowed",
    );
  });

  it("throws on BEGIN", () => {
    expect(() => checkSqlSecurity("BEGIN", connConfig)).toThrow("not allowed");
  });

  it("throws on INTO OUTFILE", () => {
    expect(() =>
      checkSqlSecurity("SELECT * FROM users INTO OUTFILE '/tmp/out'", connConfig),
    ).toThrow("not allowed");
  });

  it("does NOT throw on SELECT", () => {
    expect(() => checkSqlSecurity("SELECT 1", connConfig)).not.toThrow();
  });

  it("does NOT throw on INSERT", () => {
    expect(() => checkSqlSecurity("INSERT INTO users VALUES (1)", connConfig)).not.toThrow();
  });
});
