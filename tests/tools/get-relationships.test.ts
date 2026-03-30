import { describe, it, expect, vi } from "vitest";
import { handleGetRelationships } from "../../src/tools/get-relationships.js";
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
        {
          name: "user_id",
          type: "INT",
          nullable: false,
          defaultValue: null,
          isPrimaryKey: false,
          comment: null,
        },
      ],
      primaryKey: ["id"],
      indexes: [],
      foreignKeys: [{ column: "user_id", referencesTable: "users", referencesColumn: "id" }],
      rowCountEstimate: 20,
      exactCount: false,
      comment: null,
    },
    {
      name: "comments",
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
          name: "post_id",
          type: "INT",
          nullable: false,
          defaultValue: null,
          isPrimaryKey: false,
          comment: null,
        },
        {
          name: "user_id",
          type: "INT",
          nullable: false,
          defaultValue: null,
          isPrimaryKey: false,
          comment: null,
        },
      ],
      primaryKey: ["id"],
      indexes: [],
      foreignKeys: [
        { column: "post_id", referencesTable: "posts", referencesColumn: "id" },
        { column: "user_id", referencesTable: "users", referencesColumn: "id" },
      ],
      rowCountEstimate: 50,
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

describe("handleGetRelationships", () => {
  it("returns all relationships", async () => {
    const { cm, config } = setup();
    const result = await handleGetRelationships(config, cm, { connection: "test" });
    expect(result.relationships).toHaveLength(3);
    expect(result.relationships[0]).toEqual({
      from_table: "posts",
      from_column: "user_id",
      to_table: "users",
      to_column: "id",
    });
  });

  it("builds graph with references and referenced_by", async () => {
    const { cm, config } = setup();
    const result = await handleGetRelationships(config, cm, { connection: "test" });
    const usersNode = result.graph.find((n: { name: string }) => n.name === "users");
    expect(usersNode).toBeDefined();
    expect(usersNode!.referenced_by.length).toBe(2); // posts and comments reference users
    expect(usersNode!.references.length).toBe(0);
  });

  it("filters to a specific table", async () => {
    const { cm, config } = setup();
    const result = await handleGetRelationships(config, cm, { connection: "test", table: "posts" });
    // posts -> users, and comments -> posts
    expect(result.relationships).toHaveLength(2);
  });

  it("throws for nonexistent table", async () => {
    const { cm, config } = setup();
    await expect(
      handleGetRelationships(config, cm, { connection: "test", table: "nonexistent" }),
    ).rejects.toThrow("not found");
  });
});
