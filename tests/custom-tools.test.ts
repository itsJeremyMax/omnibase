import { describe, it, expect } from "vitest";
import {
  validateCustomTools,
  extractPlaceholders,
  extractSqlDescription,
  substituteParameters,
  buildZodSchema,
  registerCustomTools,
  executeCustomToolForTest,
  executeCustomTool,
} from "../src/custom-tools.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectionManager } from "../src/connection-manager.js";
import type { DatabaseBackend, QueryResult } from "../src/types.js";
import type { OmnibaseConfig } from "../src/types.js";
import { vi } from "vitest";

function makeConfig(
  toolsOverride?: OmnibaseConfig["tools"],
  connectionOverrides?: Partial<OmnibaseConfig["connections"]["string"]>,
): OmnibaseConfig {
  return {
    connections: {
      "my-db": {
        name: "my-db",
        dsn: "sqlite::memory:",
        permission: "read-only",
        timeout: 5000,
        maxRows: 100,
        ...connectionOverrides,
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

  it("rejects a tool with no description and no SQL comments", () => {
    const config = makeConfig({
      no_desc: {
        connection: "my-db",
        sql: "SELECT * FROM users",
      } as any,
    });
    expect(() => validateCustomTools(config)).toThrow("description");
  });
});

describe("extractSqlDescription", () => {
  it("returns undefined when SQL has no leading comments", () => {
    expect(extractSqlDescription("SELECT * FROM users")).toBeUndefined();
  });

  it("extracts a single comment line", () => {
    const sql = "-- Get all users\nSELECT * FROM users";
    expect(extractSqlDescription(sql)).toBe("Get all users");
  });

  it("joins multiple comment lines with a space", () => {
    const sql = "-- Get active users\n-- Returns: id, name\nSELECT * FROM users";
    expect(extractSqlDescription(sql)).toBe("Get active users Returns: id, name");
  });

  it("stops at the first non-comment, non-blank line", () => {
    const sql = "-- First\nSELECT 1\n-- Not extracted";
    expect(extractSqlDescription(sql)).toBe("First");
  });

  it("skips leading blank lines before comments", () => {
    const sql = "\n-- Comment after blank\nSELECT 1";
    expect(extractSqlDescription(sql)).toBe("Comment after blank");
  });

  it("returns undefined for lines starting with -- but no space", () => {
    expect(extractSqlDescription("--no space\nSELECT 1")).toBeUndefined();
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

describe("validateCustomTools steps", () => {
  it("accepts a valid steps tool", () => {
    const config = makeConfig({
      transfer: {
        connection: "my-db",
        description: "Transfer",
        steps: [
          { sql: "UPDATE accounts SET balance = balance - 100 WHERE id = 1" },
          { sql: "UPDATE accounts SET balance = balance + 100 WHERE id = 2" },
        ],
      },
    });
    expect(() => validateCustomTools(config)).not.toThrow();
  });

  it("rejects tool with both sql and steps", () => {
    const config = makeConfig({
      bad_tool: {
        connection: "my-db",
        description: "Bad",
        sql: "SELECT 1",
        steps: [{ sql: "SELECT 2" }],
      },
    });
    expect(() => validateCustomTools(config)).toThrow("cannot define more than one");
  });

  it("rejects tool with neither sql nor steps", () => {
    const config = makeConfig({
      empty_tool: {
        connection: "my-db",
        description: "Empty",
      },
    });
    expect(() => validateCustomTools(config)).toThrow("must define either");
  });

  it("rejects empty steps array", () => {
    const config = makeConfig({
      no_steps: {
        connection: "my-db",
        description: "No steps",
        steps: [],
      },
    });
    expect(() => validateCustomTools(config)).toThrow("at least one step");
  });

  it("rejects multiple return: true steps", () => {
    const config = makeConfig({
      multi_return: {
        connection: "my-db",
        description: "Multi return",
        steps: [
          { sql: "SELECT 1", return: true },
          { sql: "SELECT 2", return: true },
        ],
      },
    });
    expect(() => validateCustomTools(config)).toThrow("at most one step");
  });

  it("collects placeholders across all steps", () => {
    const config = makeConfig({
      cross_step: {
        connection: "my-db",
        description: "Cross step params",
        steps: [
          { sql: "UPDATE t SET a = {val} WHERE id = {id}" },
          { sql: "SELECT * FROM t WHERE id = {id}" },
        ],
        parameters: {
          val: { type: "string", description: "Value" },
          id: { type: "number", description: "ID" },
        },
      },
    });
    expect(() => validateCustomTools(config)).not.toThrow();
  });

  it("rejects missing parameter across steps", () => {
    const config = makeConfig({
      missing: {
        connection: "my-db",
        description: "Missing param",
        steps: [{ sql: "SELECT 1" }, { sql: "SELECT * FROM t WHERE id = {id}" }],
      },
    });
    expect(() => validateCustomTools(config)).toThrow("id");
  });
});

describe("executeCustomToolForTest steps", () => {
  function makeRWConfig(toolsOverride: OmnibaseConfig["tools"]): OmnibaseConfig {
    return {
      connections: {
        "my-db": {
          name: "my-db",
          dsn: "sqlite::memory:",
          permission: "read-write",
          timeout: 5000,
          maxRows: 100,
        },
      },
      defaults: { permission: "read-only", timeout: 30000, maxRows: 500 },
      tools: toolsOverride,
    };
  }

  it("executes steps within BEGIN/COMMIT", async () => {
    const executeCalls: string[] = [];
    const backend = makeMockBackend();
    (backend.execute as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id: string, query: string) => {
        executeCalls.push(query);
        return { columns: ["r"], rows: [[1]], rowCount: 1, hasMore: false };
      },
    );
    const cm = new ConnectionManager(backend);
    const config = makeRWConfig({
      multi: {
        connection: "my-db",
        description: "Multi",
        steps: [{ sql: "INSERT INTO t VALUES (1)" }, { sql: "SELECT * FROM t" }],
      },
    });

    await executeCustomToolForTest(config, cm, "multi", config.tools!.multi, {});

    expect(executeCalls[0]).toBe("BEGIN");
    expect(executeCalls[1]).toBe("INSERT INTO t VALUES (1)");
    expect(executeCalls[2]).toBe("SELECT * FROM t");
    expect(executeCalls[3]).toBe("COMMIT");
  });

  it("returns result from step marked return: true", async () => {
    const backend = makeMockBackend();
    let callIndex = 0;
    (backend.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callIndex++;
      if (callIndex === 2) {
        // First step (after BEGIN)
        return { columns: ["inserted"], rows: [[42]], rowCount: 1, hasMore: false };
      }
      if (callIndex === 3) {
        // Second step (the return step)
        return { columns: ["result"], rows: [["ok"]], rowCount: 1, hasMore: false };
      }
      return { columns: [], rows: [], rowCount: 0, hasMore: false };
    });
    const cm = new ConnectionManager(backend);
    const config = makeRWConfig({
      multi: {
        connection: "my-db",
        description: "Multi",
        steps: [
          { sql: "INSERT INTO t VALUES (1)" },
          { sql: "SELECT 'ok' as result", return: true },
          { sql: "UPDATE t SET done = 1" },
        ],
      },
    });

    const result = await executeCustomToolForTest(config, cm, "multi", config.tools!.multi, {});
    expect(result.columns).toEqual(["result"]);
    expect(result.rows[0][0]).toBe("ok");
  });

  it("issues ROLLBACK on error", async () => {
    const executeCalls: string[] = [];
    const backend = makeMockBackend();
    (backend.execute as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id: string, query: string) => {
        executeCalls.push(query);
        if (query.startsWith("INSERT")) {
          throw new Error("insert failed");
        }
        return { columns: [], rows: [], rowCount: 0, hasMore: false };
      },
    );
    const cm = new ConnectionManager(backend);
    const config = makeRWConfig({
      multi: {
        connection: "my-db",
        description: "Multi",
        steps: [{ sql: "INSERT INTO t VALUES (1)" }, { sql: "SELECT 1" }],
      },
    });

    await expect(
      executeCustomToolForTest(config, cm, "multi", config.tools!.multi, {}),
    ).rejects.toThrow("insert failed");

    expect(executeCalls).toContain("ROLLBACK");
  });

  it("rejects blocked statement in a step", async () => {
    const backend = makeMockBackend();
    const cm = new ConnectionManager(backend);
    const config = makeRWConfig({
      bad: {
        connection: "my-db",
        description: "Bad",
        steps: [{ sql: "SELECT 1" }, { sql: "ATTACH DATABASE '/tmp/x' AS x" }],
      },
    });

    await expect(
      executeCustomToolForTest(config, cm, "bad", config.tools!.bad, {}),
    ).rejects.toThrow("not allowed");
  });

  it("defaults to last step result when no return marker", async () => {
    const backend = makeMockBackend();
    let callIndex = 0;
    (backend.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callIndex++;
      if (callIndex === 2) {
        return { columns: ["a"], rows: [["first"]], rowCount: 1, hasMore: false };
      }
      if (callIndex === 3) {
        return { columns: ["b"], rows: [["last"]], rowCount: 1, hasMore: false };
      }
      return { columns: [], rows: [], rowCount: 0, hasMore: false };
    });
    const cm = new ConnectionManager(backend);
    const config = makeRWConfig({
      multi: {
        connection: "my-db",
        description: "Multi",
        steps: [{ sql: "SELECT 'first' as a" }, { sql: "SELECT 'last' as b" }],
      },
    });

    const result = await executeCustomToolForTest(config, cm, "multi", config.tools!.multi, {});
    expect(result.columns).toEqual(["b"]);
    expect(result.rows[0][0]).toBe("last");
  });
});

describe("validateCustomTools compose", () => {
  it("accepts a valid compose tool", () => {
    const config = makeConfig({
      get_ids: {
        connection: "my-db",
        description: "Get IDs",
        sql: "SELECT id FROM users",
      },
      composed: {
        connection: "my-db",
        description: "Composed tool",
        compose: [
          { tool: "get_ids", as: "ids" },
          { sql: "SELECT * FROM orders WHERE user_id IN ({ids.id})", as: "orders" },
        ],
      },
    });
    expect(() => validateCustomTools(config)).not.toThrow();
  });

  it("rejects compose with empty steps", () => {
    const config = makeConfig({
      bad: {
        connection: "my-db",
        description: "Bad",
        compose: [],
      },
    });
    expect(() => validateCustomTools(config)).toThrow("at least one step");
  });

  it("rejects compose step with neither tool nor sql", () => {
    const config = makeConfig({
      bad: {
        connection: "my-db",
        description: "Bad",
        compose: [{ as: "step1" } as any],
      },
    });
    expect(() => validateCustomTools(config)).toThrow("exactly one of");
  });

  it("rejects compose step referencing unknown tool", () => {
    const config = makeConfig({
      bad: {
        connection: "my-db",
        description: "Bad",
        compose: [{ tool: "nonexistent", as: "step1" }],
      },
    });
    expect(() => validateCustomTools(config)).toThrow("unknown tool 'nonexistent'");
  });

  it("rejects duplicate step names", () => {
    const config = makeConfig({
      helper: {
        connection: "my-db",
        description: "Helper",
        sql: "SELECT 1",
      },
      bad: {
        connection: "my-db",
        description: "Bad",
        compose: [
          { tool: "helper", as: "step1" },
          { sql: "SELECT 2", as: "step1" },
        ],
      },
    });
    expect(() => validateCustomTools(config)).toThrow("duplicate compose step name 'step1'");
  });

  it("detects circular dependencies", () => {
    const config = makeConfig({
      tool_a: {
        connection: "my-db",
        description: "A",
        compose: [{ tool: "tool_b", as: "step1" }],
      },
      tool_b: {
        connection: "my-db",
        description: "B",
        compose: [{ tool: "tool_a", as: "step1" }],
      },
    });
    expect(() => validateCustomTools(config)).toThrow("Circular dependency");
  });

  it("rejects step name that shadows a parameter", () => {
    const config = makeConfig({
      helper: {
        connection: "my-db",
        description: "Helper",
        sql: "SELECT 1",
      },
      bad: {
        connection: "my-db",
        description: "Bad",
        compose: [{ tool: "helper", as: "status" }],
        parameters: {
          status: { type: "string", description: "Status" },
        },
      },
    });
    expect(() => validateCustomTools(config)).toThrow("shadows a parameter");
  });
});

describe("executeCustomTool compose", () => {
  function makeRWConfig(toolsOverride: OmnibaseConfig["tools"]): OmnibaseConfig {
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

  it("executes a two-step compose pipeline with ID expansion", async () => {
    const executeCalls: { query: string; params: unknown[] }[] = [];
    const backend = makeMockBackend();
    (backend.execute as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id: string, query: string, params?: unknown[]) => {
        executeCalls.push({ query, params: params ?? [] });
        if (query.includes("FROM users")) {
          return { columns: ["id"], rows: [[1], [2], [3]], rowCount: 3, hasMore: false };
        }
        return {
          columns: ["order_id", "user_id"],
          rows: [
            [10, 1],
            [20, 2],
          ],
          rowCount: 2,
          hasMore: false,
        };
      },
    );
    const cm = new ConnectionManager(backend);
    const config = makeRWConfig({
      get_user_ids: {
        connection: "my-db",
        description: "Get user IDs",
        sql: "SELECT id FROM users WHERE active = true",
      },
      user_orders: {
        connection: "my-db",
        description: "Get orders for active users",
        compose: [
          { tool: "get_user_ids", as: "users" },
          { sql: "SELECT * FROM orders WHERE user_id IN ({users.id})", as: "orders" },
        ],
      },
    });

    const result = await executeCustomTool(
      config,
      cm,
      "user_orders",
      config.tools!.user_orders,
      {},
    );
    expect(result.columns).toEqual(["order_id", "user_id"]);
    expect(result.rows).toEqual([
      [10, 1],
      [20, 2],
    ]);

    // Verify the second step expanded the IDs
    const orderQuery = executeCalls.find((c) => c.query.includes("orders"));
    expect(orderQuery).toBeDefined();
    expect(orderQuery!.query).toContain("1, 2, 3");
  });

  it("propagates errors from referenced tools", async () => {
    const backend = makeMockBackend();
    (backend.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db error"));
    const cm = new ConnectionManager(backend);
    const config = makeRWConfig({
      failing_tool: {
        connection: "my-db",
        description: "Fails",
        sql: "SELECT 1/0",
      },
      composed: {
        connection: "my-db",
        description: "Uses failing tool",
        compose: [
          { tool: "failing_tool", as: "step1" },
          { sql: "SELECT 1", as: "step2" },
        ],
      },
    });

    await expect(
      executeCustomTool(config, cm, "composed", config.tools!.composed, {}),
    ).rejects.toThrow("db error");
  });

  it("throws on empty result used in compose reference", async () => {
    const backend = makeMockBackend();
    (backend.execute as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id: string, query: string) => {
        if (query.includes("FROM users")) {
          return { columns: ["id"], rows: [], rowCount: 0, hasMore: false };
        }
        return { columns: ["id"], rows: [[1]], rowCount: 1, hasMore: false };
      },
    );
    const cm = new ConnectionManager(backend);
    const config = makeRWConfig({
      get_users: {
        connection: "my-db",
        description: "Get users",
        sql: "SELECT id FROM users WHERE active = false",
      },
      composed: {
        connection: "my-db",
        description: "Composed",
        compose: [
          { tool: "get_users", as: "users" },
          { sql: "SELECT * FROM orders WHERE user_id IN ({users.id})", as: "orders" },
        ],
      },
    });

    await expect(
      executeCustomTool(config, cm, "composed", config.tools!.composed, {}),
    ).rejects.toThrow("returned no rows");
  });
});
