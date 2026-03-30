import { describe, it, expect, vi } from "vitest";
import { handleGetIndexes } from "../../src/tools/get-indexes.js";
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
      indexes: [{ name: "idx_users_email", columns: ["email"], unique: true }],
      foreignKeys: [],
      rowCountEstimate: 10,
      exactCount: false,
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
      indexes: [
        { name: "idx_posts_user_id", columns: ["user_id"], unique: false },
        { name: "idx_posts_created", columns: ["created_at"], unique: false },
      ],
      foreignKeys: [],
      rowCountEstimate: 20,
      exactCount: false,
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

describe("handleGetIndexes", () => {
  it("returns all indexes across tables", async () => {
    const { cm, config } = setup();
    const result = await handleGetIndexes(config, cm, { connection: "test" });
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      table: "users",
      name: "idx_users_email",
      columns: ["email"],
      unique: true,
    });
  });

  it("filters to a specific table", async () => {
    const { cm, config } = setup();
    const result = await handleGetIndexes(config, cm, { connection: "test", table: "posts" });
    expect(result).toHaveLength(2);
    expect(result.every((i: { table: string }) => i.table === "posts")).toBe(true);
  });

  it("throws for nonexistent table", async () => {
    const { cm, config } = setup();
    await expect(
      handleGetIndexes(config, cm, { connection: "test", table: "nonexistent" }),
    ).rejects.toThrow("not found");
  });
});
