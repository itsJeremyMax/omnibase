import { describe, it, expect, vi } from "vitest";
import { handleGetTableStats } from "../../src/tools/get-table-stats.js";
import { ConnectionManager } from "../../src/connection-manager.js";
import type { OmnibaseConfig, SchemaInfo, QueryResult } from "../../src/types.js";

const mockSchema: SchemaInfo = {
  tables: [
    {
      name: "users",
      schema: "main",
      columns: [
        {
          name: "id",
          type: "INTEGER",
          nullable: false,
          defaultValue: null,
          isPrimaryKey: true,
          comment: null,
        },
        {
          name: "name",
          type: "TEXT",
          nullable: false,
          defaultValue: null,
          isPrimaryKey: false,
          comment: null,
        },
        {
          name: "email",
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
      rowCountEstimate: 3,
      comment: null,
    },
  ],
};

function setup() {
  const statsResult: QueryResult = {
    columns: [
      "_total",
      "_null_id",
      "_distinct_id",
      "_min_id",
      "_max_id",
      "_null_name",
      "_distinct_name",
      "_min_name",
      "_max_name",
      "_null_email",
      "_distinct_email",
      "_min_email",
      "_max_email",
    ],
    rows: [[3, 0, 3, 1, 3, 0, 3, "Alice", "Charlie", 1, 2, "alice@example.com", "bob@example.com"]],
    rowCount: 1,
    hasMore: false,
  };

  const backend = {
    connect: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue(statsResult),
    getSchema: vi.fn().mockResolvedValue(mockSchema),
    ping: vi.fn(),
    disconnect: vi.fn(),
  };
  const cm = new ConnectionManager(backend);
  const config: OmnibaseConfig = {
    connections: {
      test: {
        name: "test",
        dsn: "sqlite::memory:",
        permission: "read-only",
        timeout: 5000,
        maxRows: 100,
      },
    },
    defaults: { permission: "read-only", timeout: 30000, maxRows: 500 },
  };
  return { cm, config, backend };
}

describe("handleGetTableStats", () => {
  it("returns stats for all columns", async () => {
    const { cm, config } = setup();
    const result = await handleGetTableStats(config, cm, { connection: "test", table: "users" });
    expect(result.table).toBe("users");
    expect(result.columns).toHaveLength(3);

    const idStats = result.columns.find((c: { name: string }) => c.name === "id")!;
    expect(idStats.total_rows).toBe(3);
    expect(idStats.null_count).toBe(0);
    expect(idStats.null_percentage).toBe(0);
    expect(idStats.distinct_count).toBe(3);
    expect(idStats.min).toBe(1);
    expect(idStats.max).toBe(3);

    const emailStats = result.columns.find((c: { name: string }) => c.name === "email")!;
    expect(emailStats.null_count).toBe(1);
    expect(emailStats.null_percentage).toBeGreaterThan(0);
  });

  it("throws on unknown table", async () => {
    const { cm, config } = setup();
    await expect(
      handleGetTableStats(config, cm, { connection: "test", table: "nonexistent" }),
    ).rejects.toThrow("not found");
  });

  it("throws on unknown connection", async () => {
    const { cm, config } = setup();
    await expect(
      handleGetTableStats(config, cm, { connection: "nope", table: "users" }),
    ).rejects.toThrow("Unknown connection");
  });
});
