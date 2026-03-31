import { describe, it, expect } from "vitest";
import { parseConfig, resolveConfigPath } from "../src/config.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("parseConfig", () => {
  it("parses a valid config with defaults", () => {
    const yaml = `
connections:
  local:
    dsn: sqlite:./test.db
    permission: admin
defaults:
  permission: read-only
  timeout: 30000
  max_rows: 500
`;
    const config = parseConfig(yaml);
    expect(config.connections.local.dsn).toBe("sqlite:./test.db");
    expect(config.connections.local.permission).toBe("admin");
    expect(config.connections.local.timeout).toBe(30000);
    expect(config.connections.local.maxRows).toBe(500);
  });

  it("applies defaults when connection omits fields", () => {
    const yaml = `
connections:
  local:
    dsn: sqlite:./test.db
defaults:
  permission: read-only
  timeout: 15000
  max_rows: 200
`;
    const config = parseConfig(yaml);
    expect(config.connections.local.permission).toBe("read-only");
    expect(config.connections.local.timeout).toBe(15000);
    expect(config.connections.local.maxRows).toBe(200);
  });

  it("resolves env var DSNs", () => {
    process.env.TEST_DSN = "pg://user:pass@localhost/db";
    const yaml = `
connections:
  prod:
    dsn: $TEST_DSN
defaults:
  permission: read-only
  timeout: 30000
  max_rows: 500
`;
    const config = parseConfig(yaml);
    expect(config.connections.prod.dsn).toBe("pg://user:pass@localhost/db");
    delete process.env.TEST_DSN;
  });

  it("throws on missing env var", () => {
    const yaml = `
connections:
  prod:
    dsn: $NONEXISTENT_VAR
defaults:
  permission: read-only
  timeout: 30000
  max_rows: 500
`;
    expect(() => parseConfig(yaml)).toThrow("NONEXISTENT_VAR");
  });

  it("throws on missing dsn", () => {
    const yaml = `
connections:
  local:
    permission: read-only
defaults:
  permission: read-only
  timeout: 30000
  max_rows: 500
`;
    expect(() => parseConfig(yaml)).toThrow("dsn");
  });

  it("throws on invalid permission level", () => {
    const yaml = `
connections:
  local:
    dsn: sqlite:./test.db
    permission: superuser
defaults:
  permission: read-only
  timeout: 30000
  max_rows: 500
`;
    expect(() => parseConfig(yaml)).toThrow("permission");
  });

  it("uses built-in defaults when defaults section is omitted", () => {
    const yaml = `
connections:
  local:
    dsn: sqlite:./test.db
`;
    const config = parseConfig(yaml);
    expect(config.connections.local.permission).toBe("read-only");
    expect(config.connections.local.timeout).toBe(30000);
    expect(config.connections.local.maxRows).toBe(500);
  });

  it("allows partial defaults section", () => {
    const yaml = `
connections:
  local:
    dsn: sqlite:./test.db
defaults:
  permission: admin
`;
    const config = parseConfig(yaml);
    expect(config.connections.local.permission).toBe("admin");
    expect(config.connections.local.timeout).toBe(30000);
    expect(config.connections.local.maxRows).toBe(500);
  });

  it("parses schema_filter", () => {
    const yaml = `
connections:
  prod:
    dsn: sqlite:./test.db
    schema_filter:
      schemas: [public, analytics]
      tables: [users, events]
defaults:
  permission: read-only
  timeout: 30000
  max_rows: 500
`;
    const config = parseConfig(yaml);
    expect(config.connections.prod.schemaFilter?.schemas).toEqual(["public", "analytics"]);
    expect(config.connections.prod.schemaFilter?.tables).toEqual(["users", "events"]);
  });
});

describe("parseConfig tools section", () => {
  it("parses tools with all fields", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
tools:
  find_orders:
    connection: my-db
    description: "Find orders by status"
    permission: read-write
    max_rows: 1000
    timeout: 15000
    sql: "SELECT * FROM orders WHERE status = {status}"
    parameters:
      status:
        type: enum
        description: "Order status"
        values: [pending, shipped]
`;
    const config = parseConfig(yaml);
    expect(config.tools).toBeDefined();
    expect(config.tools!.find_orders).toEqual({
      connection: "my-db",
      description: "Find orders by status",
      permission: "read-write",
      maxRows: 1000,
      timeout: 15000,
      sql: "SELECT * FROM orders WHERE status = {status}",
      parameters: {
        status: {
          type: "enum",
          description: "Order status",
          required: true,
          values: ["pending", "shipped"],
        },
      },
    });
  });

  it("parses tools with minimal fields", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
tools:
  get_users:
    connection: my-db
    description: "Get all users"
    sql: "SELECT * FROM users"
`;
    const config = parseConfig(yaml);
    expect(config.tools!.get_users).toEqual({
      connection: "my-db",
      description: "Get all users",
      sql: "SELECT * FROM users",
    });
  });

  it("parses optional parameters with defaults", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
tools:
  find_orders:
    connection: my-db
    description: "Find orders"
    sql: "SELECT * FROM orders WHERE total >= {min_amount}"
    parameters:
      min_amount:
        type: number
        description: "Minimum amount"
        required: false
        default: 0
`;
    const config = parseConfig(yaml);
    const param = config.tools!.find_orders.parameters!.min_amount;
    expect(param.required).toBe(false);
    expect(param.default).toBe(0);
  });

  it("returns undefined tools when section is omitted", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
`;
    const config = parseConfig(yaml);
    expect(config.tools).toBeUndefined();
  });

  it("derives description from SQL comments when description is omitted", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
tools:
  get_users:
    connection: my-db
    sql: |
      -- Get all active users
      -- Returns id and name
      SELECT * FROM users WHERE active = true
`;
    const config = parseConfig(yaml);
    expect(config.tools!.get_users.description).toBe("Get all active users Returns id and name");
  });

  it("prefers explicit description over SQL comments", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
tools:
  get_users:
    connection: my-db
    description: "Explicit description"
    sql: |
      -- SQL comment description
      SELECT * FROM users
`;
    const config = parseConfig(yaml);
    expect(config.tools!.get_users.description).toBe("Explicit description");
  });
});

describe("parseConfig with steps tools", () => {
  it("parses a tool with steps", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
tools:
  transfer:
    connection: my-db
    description: "Transfer funds"
    steps:
      - sql: "UPDATE accounts SET balance = balance - {amount} WHERE id = {from_id}"
      - sql: "UPDATE accounts SET balance = balance + {amount} WHERE id = {to_id}"
        return: true
    parameters:
      amount:
        type: number
        description: "Amount"
      from_id:
        type: number
        description: "Source account"
      to_id:
        type: number
        description: "Destination account"
`;
    const config = parseConfig(yaml);
    expect(config.tools).toBeDefined();
    const tool = config.tools!.transfer;
    expect(tool.sql).toBeUndefined();
    expect(tool.steps).toHaveLength(2);
    expect(tool.steps![0].sql).toBe(
      "UPDATE accounts SET balance = balance - {amount} WHERE id = {from_id}",
    );
    expect(tool.steps![0].return).toBeUndefined();
    expect(tool.steps![1].return).toBe(true);
  });

  it("parses a tool with steps and no return marker", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
tools:
  setup:
    connection: my-db
    description: "Setup tables"
    steps:
      - sql: "CREATE TABLE IF NOT EXISTS a (id INTEGER)"
      - sql: "CREATE TABLE IF NOT EXISTS b (id INTEGER)"
`;
    const config = parseConfig(yaml);
    const tool = config.tools!.setup;
    expect(tool.steps).toHaveLength(2);
    expect(tool.steps![0].return).toBeUndefined();
    expect(tool.steps![1].return).toBeUndefined();
  });

  it("does not attempt SQL description extraction for steps tools", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
tools:
  multi:
    connection: my-db
    description: "Multi step tool"
    steps:
      - sql: "SELECT 1"
`;
    const config = parseConfig(yaml);
    expect(config.tools!.multi.description).toBe("Multi step tool");
    expect(config.tools!.multi.sql).toBeUndefined();
  });
});

describe("parseConfig with compose tools", () => {
  it("parses a tool with compose pipeline", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
tools:
  get_ids:
    connection: my-db
    description: "Get IDs"
    sql: "SELECT id FROM users"
  user_orders:
    connection: my-db
    description: "Orders for active users"
    compose:
      - tool: get_ids
        as: users
      - sql: "SELECT * FROM orders WHERE user_id IN ({users.id})"
        as: orders
`;
    const config = parseConfig(yaml);
    expect(config.tools).toBeDefined();
    const tool = config.tools!.user_orders;
    expect(tool.sql).toBeUndefined();
    expect(tool.steps).toBeUndefined();
    expect(tool.compose).toHaveLength(2);
    expect(tool.compose![0]).toEqual({ tool: "get_ids", args: undefined, as: "users" });
    expect(tool.compose![1]).toEqual({
      sql: "SELECT * FROM orders WHERE user_id IN ({users.id})",
      as: "orders",
    });
  });

  it("parses compose step with args", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
tools:
  find_users:
    connection: my-db
    description: "Find users"
    sql: "SELECT id FROM users WHERE role = {role}"
    parameters:
      role:
        type: string
        description: "Role"
  composed:
    connection: my-db
    description: "Composed"
    compose:
      - tool: find_users
        args:
          role: admin
        as: admins
      - sql: "SELECT * FROM t WHERE id IN ({admins.id})"
        as: result
`;
    const config = parseConfig(yaml);
    const step = config.tools!.composed.compose![0]!;
    expect(step.tool).toBe("find_users");
    expect(step.args).toEqual({ role: "admin" });
    expect(step.as).toBe("admins");
  });
});

describe("parseConfig audit section", () => {
  it("defaults audit log path to .omnibase/audit.log relative to config file", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
audit:
  enabled: true
`;
    const config = parseConfig(yaml, "/projects/myapp/omnibase.config.yaml");
    expect(config.audit).toBeDefined();
    expect(config.audit!.enabled).toBe(true);
    expect(config.audit!.path).toBe(join("/projects/myapp", ".omnibase", "audit.log"));
  });

  it("defaults audit log path to cwd when no config path provided", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
audit:
  enabled: true
`;
    const config = parseConfig(yaml);
    expect(config.audit!.path).toContain(".omnibase");
    expect(config.audit!.path).toContain("audit.log");
  });

  it("uses explicit path when provided", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
audit:
  enabled: true
  path: /custom/path/audit.log
`;
    const config = parseConfig(yaml, "/projects/myapp/omnibase.config.yaml");
    expect(config.audit!.path).toBe("/custom/path/audit.log");
  });

  it("defaults to disabled when enabled is not set", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
audit: {}
`;
    const config = parseConfig(yaml);
    expect(config.audit!.enabled).toBe(false);
  });

  it("defaults max_entries to 10000", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
audit:
  enabled: true
`;
    const config = parseConfig(yaml);
    expect(config.audit!.maxEntries).toBe(10000);
  });

  it("returns undefined audit when section is omitted", () => {
    const yaml = `
connections:
  my-db:
    dsn: sqlite:./test.db
`;
    const config = parseConfig(yaml);
    expect(config.audit).toBeUndefined();
  });
});

describe("resolveConfigPath", () => {
  const tempDir = join(tmpdir(), "omnibase-test-" + Date.now());

  it("returns OMNIBASE_CONFIG env var path first", () => {
    const configPath = join(tempDir, "custom.yaml");
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(
      configPath,
      "connections: {}\ndefaults:\n  permission: read-only\n  timeout: 30000\n  max_rows: 500",
    );
    process.env.OMNIBASE_CONFIG = configPath;

    const result = resolveConfigPath(tempDir);
    expect(result).toBe(configPath);

    delete process.env.OMNIBASE_CONFIG;
    rmSync(tempDir, { recursive: true });
  });

  it("returns null when no config found", () => {
    const emptyDir = join(tmpdir(), "omnibase-empty-" + Date.now());
    mkdirSync(emptyDir, { recursive: true });

    const result = resolveConfigPath(emptyDir);
    expect(result).toBeNull();

    rmSync(emptyDir, { recursive: true });
  });
});
