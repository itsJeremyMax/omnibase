import { describe, it, expect, vi } from "vitest";
import { detectDbType, pingAllConnections, renderDashboard } from "../../src/cli/status.js";
import { ConnectionManager } from "../../src/connection-manager.js";
import type { OmnibaseConfig, DatabaseBackend } from "../../src/types.js";
import type { PingResult } from "../../src/cli/status.js";

describe("detectDbType", () => {
  it("returns sqlite for sqlite DSNs", () => {
    expect(detectDbType("sqlite:./app.db")).toBe("sqlite");
  });

  it("returns postgres for pg DSNs", () => {
    expect(detectDbType("pg://user:pass@host/db")).toBe("postgres");
    expect(detectDbType("postgres://user:pass@host/db")).toBe("postgres");
  });

  it("returns mysql for mysql DSNs", () => {
    expect(detectDbType("mysql://user:pass@host/db")).toBe("mysql");
    expect(detectDbType("my://user:pass@host/db")).toBe("mysql");
  });

  it("returns the raw prefix for unknown DSN types", () => {
    expect(detectDbType("mssql://server/db")).toBe("mssql");
  });
});

function makeMockBackend(overrides?: Partial<DatabaseBackend>): DatabaseBackend {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn(),
    getSchema: vi.fn(),
    explainQuery: vi.fn(),
    validateQuery: vi.fn(),
    ping: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    ...overrides,
  };
}

const testConfig: OmnibaseConfig = {
  connections: {
    "app-db": {
      name: "app-db",
      dsn: "sqlite:./app.db",
      permission: "read-write",
      timeout: 5000,
      maxRows: 500,
    },
    "orders-db": {
      name: "orders-db",
      dsn: "pg://host/orders",
      permission: "admin",
      timeout: 5000,
      maxRows: 500,
    },
  },
  defaults: { permission: "read-only", timeout: 5000, maxRows: 500 },
};

describe("pingAllConnections", () => {
  it("returns ok result when ping succeeds", async () => {
    const cm = new ConnectionManager(makeMockBackend());
    const results = await pingAllConnections(testConfig, cm);
    const appDb = results.find((r) => r.name === "app-db")!;
    expect(appDb.status).toBe("ok");
    expect(appDb.dbType).toBe("sqlite");
    expect(appDb.permission).toBe("read-write");
    expect(typeof appDb.latencyMs).toBe("number");
  });

  it("returns error result when ping fails", async () => {
    const cm = new ConnectionManager(
      makeMockBackend({
        connect: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
        ping: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      }),
    );
    const results = await pingAllConnections(testConfig, cm);
    const ordersDb = results.find((r) => r.name === "orders-db")!;
    expect(ordersDb.status).toBe("error");
    expect(ordersDb.error).toMatch(/ECONNREFUSED/);
  });

  it("returns results in config order", async () => {
    const cm = new ConnectionManager(makeMockBackend());
    const results = await pingAllConnections(testConfig, cm);
    expect(results.map((r) => r.name)).toEqual(["app-db", "orders-db"]);
  });
});

describe("renderDashboard", () => {
  it("includes connection info in output", () => {
    const results: PingResult[] = [
      { name: "app-db", dbType: "sqlite", permission: "read-write", latencyMs: 2, status: "ok" },
      {
        name: "orders-db",
        dbType: "postgres",
        permission: "admin",
        latencyMs: null,
        status: "error",
        error: "ECONNREFUSED",
      },
    ];

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    renderDashboard(results);
    console.log = origLog;

    const output = logs.join("\n");
    expect(output).toContain("app-db");
    expect(output).toContain("orders-db");
    expect(output).toContain("sqlite");
    expect(output).toContain("postgres");
    expect(output).toContain("ECONNREFUSED");
  });

  it("shows latency with ms suffix", () => {
    const results: PingResult[] = [
      { name: "db", dbType: "sqlite", permission: "read-only", latencyMs: 42, status: "ok" },
    ];
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    renderDashboard(results);
    console.log = origLog;
    expect(logs.join("\n")).toContain("42ms");
  });

  it("shows -- for latency on error", () => {
    const results: PingResult[] = [
      {
        name: "db",
        dbType: "pg",
        permission: "read-only",
        latencyMs: null,
        status: "error",
        error: "timeout",
      },
    ];
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    renderDashboard(results);
    console.log = origLog;
    expect(logs.join("\n")).toContain("--");
  });
});
