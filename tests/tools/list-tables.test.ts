import { describe, it, expect, vi } from "vitest";
import { handleListTables } from "../../src/tools/list-tables.js";
import { ConnectionManager } from "../../src/connection-manager.js";
import type { OmnibaseConfig, SchemaInfo } from "../../src/types.js";

const mockSchema: SchemaInfo = {
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
      ],
      primaryKey: ["id"],
      indexes: [],
      foreignKeys: [],
      rowCountEstimate: 100,
      exactCount: true,
      comment: null,
    },
    {
      name: "posts",
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
      ],
      primaryKey: ["id"],
      indexes: [],
      foreignKeys: [],
      rowCountEstimate: 50,
      exactCount: true,
      comment: null,
    },
  ],
};

function setup() {
  const backend = {
    connect: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn(),
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

describe("handleListTables", () => {
  it("returns table names and row counts", async () => {
    const { cm, config } = setup();
    const result = await handleListTables(config, cm, { connection: "test" });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "users", schema: "main", row_count: 100 });
    expect(result[1]).toEqual({ name: "posts", schema: "main", row_count: 50 });
  });

  it("returns row_count_estimate when exact_counts is false", async () => {
    const estimateSchema: SchemaInfo = {
      tables: mockSchema.tables.map((t) => ({ ...t, exactCount: false })),
    };
    const backend = {
      connect: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn(),
      getSchema: vi.fn().mockResolvedValue(estimateSchema),
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
    const result = await handleListTables(config, cm, { connection: "test", exact_counts: false });
    expect(result[0]).toEqual({ name: "users", schema: "main", row_count_estimate: 100 });
    expect(result[1]).toEqual({ name: "posts", schema: "main", row_count_estimate: 50 });
  });

  it("throws on unknown connection", async () => {
    const { cm, config } = setup();
    await expect(handleListTables(config, cm, { connection: "nope" })).rejects.toThrow(
      "Unknown connection",
    );
  });
});
