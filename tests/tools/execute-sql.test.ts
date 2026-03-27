// tests/tools/execute-sql.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleExecuteSql } from "../../src/tools/execute-sql.js";
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
    connect: vi.fn().mockResolvedValue(undefined),
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
});
