// tests/tools/get-schema.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleGetSchema } from "../../src/tools/get-schema.js";
import { ConnectionManager } from "../../src/connection-manager.js";
import type { OmnibaseConfig, SchemaInfo } from "../../src/types.js";

describe("handleGetSchema", () => {
  const mockSchema: SchemaInfo = {
    tables: [
      {
        name: "users",
        schema: "public",
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
        ],
        primaryKey: ["id"],
        indexes: [],
        foreignKeys: [],
        rowCountEstimate: 100,
        exactCount: false,
        comment: null,
      },
      {
        name: "posts",
        schema: "public",
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
        exactCount: false,
        comment: null,
      },
    ],
  };

  function setup() {
    const backend = {
      connect: vi.fn().mockResolvedValue({ driver: "" }),
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

  it("returns summary mode when no tables specified", async () => {
    const { cm, config } = setup();
    const result = await handleGetSchema(config, cm, { connection: "test" });
    // Summary mode: no columns property
    expect(result.tables[0]).toHaveProperty("column_count");
    expect(result.tables[0]).not.toHaveProperty("columns");
  });

  it("returns full mode for specific tables", async () => {
    const { cm, config } = setup();
    const result = await handleGetSchema(config, cm, {
      connection: "test",
      tables: ["users"],
    });
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]).toHaveProperty("columns");
  });

  it("throws on unknown connection", async () => {
    const { cm, config } = setup();
    await expect(handleGetSchema(config, cm, { connection: "nonexistent" })).rejects.toThrow(
      "Unknown connection",
    );
  });
});
