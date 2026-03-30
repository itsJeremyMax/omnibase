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
