import { describe, it, expect, vi } from "vitest";
import { handleGetSample } from "../../src/tools/get-sample.js";
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
          type: "INT",
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
          name: "status",
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
  ],
};

const mockResult: QueryResult = {
  columns: ["id", "name", "status"],
  rows: [[1, "Alice", "active"]],
  rowCount: 1,
  hasMore: false,
};

function setup() {
  const backend = {
    connect: vi.fn().mockResolvedValue({ driver: "" }),
    execute: vi.fn().mockResolvedValue(mockResult),
    getSchema: vi.fn().mockResolvedValue(mockSchema),
    explainQuery: vi.fn(),
    validateQuery: vi.fn(),
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

describe("handleGetSample", () => {
  it("builds basic query without where/order_by", async () => {
    const { cm, config, backend } = setup();
    await handleGetSample(config, cm, { connection: "test", table: "users" });
    expect(backend.execute).toHaveBeenCalledWith(
      "test",
      "SELECT * FROM users LIMIT 10",
      undefined,
      expect.objectContaining({ maxRows: 100 }),
    );
  });

  it("includes where clause in query", async () => {
    const { cm, config, backend } = setup();
    await handleGetSample(config, cm, {
      connection: "test",
      table: "users",
      where: "status = 'active'",
    });
    expect(backend.execute).toHaveBeenCalledWith(
      "test",
      "SELECT * FROM users WHERE status = 'active' LIMIT 10",
      undefined,
      expect.objectContaining({ maxRows: 100 }),
    );
  });

  it("includes order_by in query", async () => {
    const { cm, config, backend } = setup();
    await handleGetSample(config, cm, {
      connection: "test",
      table: "users",
      order_by: "name ASC",
    });
    expect(backend.execute).toHaveBeenCalledWith(
      "test",
      "SELECT * FROM users ORDER BY name ASC LIMIT 10",
      undefined,
      expect.objectContaining({ maxRows: 100 }),
    );
  });

  it("includes both where and order_by", async () => {
    const { cm, config, backend } = setup();
    await handleGetSample(config, cm, {
      connection: "test",
      table: "users",
      where: "status = 'active'",
      order_by: "id DESC",
      limit: 5,
    });
    expect(backend.execute).toHaveBeenCalledWith(
      "test",
      "SELECT * FROM users WHERE status = 'active' ORDER BY id DESC LIMIT 5",
      undefined,
      expect.objectContaining({ maxRows: 100 }),
    );
  });

  it("handles MSSQL dialect with where/order_by", async () => {
    const { cm, backend } = setup();
    const mssqlConfig: OmnibaseConfig = {
      connections: {
        test: {
          name: "test",
          dsn: "mssql://host/db",
          permission: "read-only",
          timeout: 5000,
          maxRows: 100,
        },
      },
      defaults: { permission: "read-only", timeout: 30000, maxRows: 500 },
    };
    await handleGetSample(mssqlConfig, cm, {
      connection: "test",
      table: "users",
      where: "status = 'active'",
      order_by: "id DESC",
      limit: 5,
    });
    expect(backend.execute).toHaveBeenCalledWith(
      "test",
      "SELECT TOP 5 * FROM users WHERE status = 'active' ORDER BY id DESC",
      undefined,
      expect.objectContaining({ maxRows: 100 }),
    );
  });

  it("throws for nonexistent table", async () => {
    const { cm, config } = setup();
    await expect(
      handleGetSample(config, cm, { connection: "test", table: "nonexistent" }),
    ).rejects.toThrow("not found");
  });
});
