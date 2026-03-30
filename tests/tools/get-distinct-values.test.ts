import { describe, it, expect, vi } from "vitest";
import { handleGetDistinctValues } from "../../src/tools/get-distinct-values.js";
import { ConnectionManager } from "../../src/connection-manager.js";
import type { OmnibaseConfig, SchemaInfo, QueryResult } from "../../src/types.js";

const mockSchema: SchemaInfo = {
  tables: [
    {
      name: "tasks",
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
          name: "status",
          type: "TEXT",
          nullable: false,
          defaultValue: null,
          isPrimaryKey: false,
          comment: null,
        },
      ],
      primaryKey: ["id"],
      indexes: [],
      foreignKeys: [],
      rowCountEstimate: 7,
      exactCount: false,
      comment: null,
    },
  ],
};

function setup() {
  const distinctResult: QueryResult = {
    columns: ["value", "count"],
    rows: [
      ["in_progress", 3],
      ["todo", 2],
      ["done", 2],
    ],
    rowCount: 3,
    hasMore: false,
  };

  const backend = {
    connect: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue(distinctResult),
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
  return { cm, config };
}

describe("handleGetDistinctValues", () => {
  it("returns distinct values with counts", async () => {
    const { cm, config } = setup();
    const result = await handleGetDistinctValues(config, cm, {
      connection: "test",
      table: "tasks",
      column: "status",
    });
    expect(result.table).toBe("tasks");
    expect(result.column).toBe("status");
    expect(result.values).toHaveLength(3);
    expect(result.values[0]).toEqual({ value: "in_progress", count: 3 });
  });

  it("throws on unknown table", async () => {
    const { cm, config } = setup();
    await expect(
      handleGetDistinctValues(config, cm, { connection: "test", table: "nope", column: "status" }),
    ).rejects.toThrow("not found");
  });

  it("throws on unknown column", async () => {
    const { cm, config } = setup();
    await expect(
      handleGetDistinctValues(config, cm, { connection: "test", table: "tasks", column: "nope" }),
    ).rejects.toThrow("not found");
  });

  it("throws on unknown connection", async () => {
    const { cm, config } = setup();
    await expect(
      handleGetDistinctValues(config, cm, { connection: "nope", table: "tasks", column: "status" }),
    ).rejects.toThrow("Unknown connection");
  });
});
