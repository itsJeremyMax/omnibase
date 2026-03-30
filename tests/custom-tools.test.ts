import { describe, it, expect } from "vitest";
import {
  validateCustomTools,
  extractPlaceholders,
  substituteParameters,
  buildZodSchema,
  registerCustomTools,
} from "../src/custom-tools.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectionManager } from "../src/connection-manager.js";
import type { DatabaseBackend, QueryResult } from "../src/types.js";
import type { OmnibaseConfig } from "../src/types.js";
import { vi } from "vitest";

function makeConfig(toolsOverride?: OmnibaseConfig["tools"]): OmnibaseConfig {
  return {
    connections: {
      "my-db": {
        name: "my-db",
        dsn: "sqlite::memory:",
        permission: "read-only",
        timeout: 5000,
        maxRows: 100,
      },
    },
    defaults: { permission: "read-only", timeout: 30000, maxRows: 500 },
    tools: toolsOverride,
  };
}

describe("validateCustomTools", () => {
  it("accepts a valid tool with no parameters", () => {
    const config = makeConfig({
      get_users: {
        connection: "my-db",
        description: "Get users",
        sql: "SELECT * FROM users",
      },
    });
    expect(() => validateCustomTools(config)).not.toThrow();
  });

  it("accepts a valid tool with parameters", () => {
    const config = makeConfig({
      find_orders: {
        connection: "my-db",
        description: "Find orders",
        sql: "SELECT * FROM orders WHERE status = {status}",
        parameters: {
          status: {
            type: "enum",
            description: "Status",
            required: true,
            values: ["pending", "shipped"],
          },
        },
      },
    });
    expect(() => validateCustomTools(config)).not.toThrow();
  });

  it("rejects tool name with invalid characters", () => {
    const config = makeConfig({
      "my-tool!": {
        connection: "my-db",
        description: "Bad name",
        sql: "SELECT 1",
      },
    });
    expect(() => validateCustomTools(config)).toThrow("alphanumeric");
  });

  it("rejects tool name that collides with built-in", () => {
    const config = makeConfig({
      execute_sql: {
        connection: "my-db",
        description: "Collision",
        sql: "SELECT 1",
      },
    });
    expect(() => validateCustomTools(config)).toThrow("collides");
  });

  it("rejects tool referencing nonexistent connection", () => {
    const config = makeConfig({
      bad_conn: {
        connection: "nonexistent",
        description: "Bad connection",
        sql: "SELECT 1",
      },
    });
    expect(() => validateCustomTools(config)).toThrow("nonexistent");
  });

  it("rejects SQL placeholder with no matching parameter", () => {
    const config = makeConfig({
      missing_param: {
        connection: "my-db",
        description: "Missing param",
        sql: "SELECT * FROM orders WHERE status = {status}",
      },
    });
    expect(() => validateCustomTools(config)).toThrow("status");
  });

  it("rejects enum parameter with no values", () => {
    const config = makeConfig({
      bad_enum: {
        connection: "my-db",
        description: "Bad enum",
        sql: "SELECT * FROM orders WHERE status = {status}",
        parameters: {
          status: {
            type: "enum",
            description: "Status",
            required: true,
          },
        },
      },
    });
    expect(() => validateCustomTools(config)).toThrow("values");
  });

  it("rejects optional parameter with no default", () => {
    const config = makeConfig({
      no_default: {
        connection: "my-db",
        description: "No default",
        sql: "SELECT * FROM orders WHERE total >= {min}",
        parameters: {
          min: {
            type: "number",
            description: "Minimum",
            required: false,
          },
        },
      },
    });
    expect(() => validateCustomTools(config)).toThrow("default");
  });

  it("rejects invalid permission override", () => {
    const config = makeConfig({
      bad_perm: {
        connection: "my-db",
        description: "Bad perm",
        sql: "SELECT 1",
        permission: "superuser" as any,
      },
    });
    expect(() => validateCustomTools(config)).toThrow("permission");
  });

  it("does nothing when tools section is undefined", () => {
    const config = makeConfig(undefined);
    expect(() => validateCustomTools(config)).not.toThrow();
  });
});

describe("extractPlaceholders", () => {
  it("extracts placeholders from SQL", () => {
    const sql = "SELECT * FROM orders WHERE status = {status} AND total >= {min_amount}";
    expect(extractPlaceholders(sql)).toEqual(["status", "min_amount"]);
  });

  it("returns empty array when no placeholders", () => {
    expect(extractPlaceholders("SELECT * FROM users")).toEqual([]);
  });

  it("deduplicates repeated placeholders", () => {
    const sql = "SELECT * FROM t WHERE a = {x} OR b = {x}";
    expect(extractPlaceholders(sql)).toEqual(["x"]);
  });
});

describe("substituteParameters", () => {
  it("replaces placeholders with positional params", () => {
    const sql = "SELECT * FROM orders WHERE status = {status} AND total >= {min_amount}";
    const params = { status: "pending", min_amount: 100 };
    const paramDefs = {
      status: { type: "string" as const, description: "s", required: true },
      min_amount: { type: "number" as const, description: "m", required: true },
    };
    const result = substituteParameters(sql, params, paramDefs);
    expect(result.sql).toBe("SELECT * FROM orders WHERE status = ? AND total >= ?");
    expect(result.values).toEqual(["pending", 100]);
  });

  it("uses default for omitted optional params", () => {
    const sql = "SELECT * FROM orders WHERE total >= {min_amount}";
    const params = {};
    const paramDefs = {
      min_amount: { type: "number" as const, description: "m", required: false, default: 0 },
    };
    const result = substituteParameters(sql, params, paramDefs);
    expect(result.sql).toBe("SELECT * FROM orders WHERE total >= ?");
    expect(result.values).toEqual([0]);
  });

  it("coerces number parameters", () => {
    const sql = "SELECT * FROM t WHERE id = {id}";
    const params = { id: "42" };
    const paramDefs = {
      id: { type: "number" as const, description: "d", required: true },
    };
    const result = substituteParameters(sql, params, paramDefs);
    expect(result.values).toEqual([42]);
  });

  it("throws on invalid number", () => {
    const sql = "SELECT * FROM t WHERE id = {id}";
    const params = { id: "not_a_number" };
    const paramDefs = {
      id: { type: "number" as const, description: "d", required: true },
    };
    expect(() => substituteParameters(sql, params, paramDefs)).toThrow("NaN");
  });

  it("validates enum values", () => {
    const sql = "SELECT * FROM t WHERE status = {status}";
    const params = { status: "invalid" };
    const paramDefs = {
      status: { type: "enum" as const, description: "s", required: true, values: ["a", "b"] },
    };
    expect(() => substituteParameters(sql, params, paramDefs)).toThrow("invalid");
  });

  it("coerces boolean parameters", () => {
    const sql = "SELECT * FROM t WHERE active = {active}";
    const params = { active: "true" };
    const paramDefs = {
      active: { type: "boolean" as const, description: "a", required: true },
    };
    const result = substituteParameters(sql, params, paramDefs);
    expect(result.values).toEqual([true]);
  });

  it("handles repeated placeholders", () => {
    const sql = "SELECT * FROM t WHERE (status = {status} OR {status} = 'all')";
    const params = { status: "pending" };
    const paramDefs = {
      status: { type: "string" as const, description: "s", required: true },
    };
    const result = substituteParameters(sql, params, paramDefs);
    expect(result.sql).toBe("SELECT * FROM t WHERE (status = ? OR ? = 'all')");
    expect(result.values).toEqual(["pending", "pending"]);
  });
});

describe("buildZodSchema", () => {
  it("builds schema for string param", () => {
    const schema = buildZodSchema({
      name: { type: "string", description: "A name", required: true },
    });
    const result = schema.safeParse({ name: "test" });
    expect(result.success).toBe(true);
  });

  it("builds schema for optional param", () => {
    const schema = buildZodSchema({
      limit: { type: "number", description: "Limit", required: false, default: 10 },
    });
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("builds schema for enum param", () => {
    const schema = buildZodSchema({
      status: { type: "enum", description: "Status", required: true, values: ["a", "b"] },
    });
    expect(schema.safeParse({ status: "a" }).success).toBe(true);
    expect(schema.safeParse({ status: "c" }).success).toBe(false);
  });

  it("returns empty object schema when no parameters", () => {
    const schema = buildZodSchema(undefined);
    expect(schema.safeParse({}).success).toBe(true);
  });
});

function makeMockBackend(): DatabaseBackend {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue({
      columns: ["id", "status"],
      rows: [[1, "pending"]],
      rowCount: 1,
      hasMore: false,
    } satisfies QueryResult),
    getSchema: vi.fn().mockResolvedValue({ tables: [] }),
    explainQuery: vi.fn().mockResolvedValue({ columns: [], rows: [], rowCount: 0, hasMore: false }),
    validateQuery: vi.fn().mockResolvedValue({ valid: true }),
    ping: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

describe("registerCustomTools", () => {
  it("registers tools on the MCP server with custom_ prefix", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    const backend = makeMockBackend();
    const cm = new ConnectionManager(backend);
    const config = makeConfig({
      get_users: {
        connection: "my-db",
        description: "Get users",
        sql: "SELECT * FROM users",
      },
    });

    const toolSpy = vi.spyOn(server, "tool");
    registerCustomTools(server, config, cm);

    expect(toolSpy).toHaveBeenCalledWith(
      "custom_get_users",
      "Get users",
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("does nothing when no tools defined", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    const backend = makeMockBackend();
    const cm = new ConnectionManager(backend);
    const config = makeConfig(undefined);

    const toolSpy = vi.spyOn(server, "tool");
    registerCustomTools(server, config, cm);

    expect(toolSpy).not.toHaveBeenCalled();
  });

  it("returns handles map for registered tools", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    const backend = makeMockBackend();
    const cm = new ConnectionManager(backend);
    const config = makeConfig({
      get_users: {
        connection: "my-db",
        description: "Get users",
        sql: "SELECT * FROM users",
      },
    });

    const handles = registerCustomTools(server, config, cm);
    expect(handles.size).toBe(1);
    expect(handles.has("custom_get_users")).toBe(true);
  });
});
