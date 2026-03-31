import { describe, it, expect, vi } from "vitest";
import { handleExplainQuery } from "../../src/tools/explain-query.js";
import { ConnectionManager } from "../../src/connection-manager.js";
import type { OmnibaseConfig, QueryResult } from "../../src/types.js";

const mockPlanResult: QueryResult = {
  columns: ["QUERY PLAN"],
  rows: [["Seq Scan on users (cost=0.00..1.50 rows=50 width=100)"]],
  rowCount: 1,
  hasMore: false,
};

const mockAnalyzeResult: QueryResult = {
  columns: ["QUERY PLAN"],
  rows: [
    [
      "Seq Scan on users (cost=0.00..1.50 rows=50 width=100) (actual time=0.01..0.02 rows=50 loops=1)",
    ],
  ],
  rowCount: 1,
  hasMore: false,
};

function setup() {
  const backend = {
    connect: vi.fn().mockResolvedValue({ driver: "" }),
    execute: vi.fn(),
    getSchema: vi.fn(),
    explainQuery: vi.fn().mockResolvedValue(mockPlanResult),
    validateQuery: vi.fn(),
    ping: vi.fn(),
    disconnect: vi.fn(),
  };
  const cm = new ConnectionManager(backend);
  const config: OmnibaseConfig = {
    connections: {
      test: {
        name: "test",
        dsn: "pg://host/db",
        permission: "read-only",
        timeout: 5000,
        maxRows: 100,
      },
    },
    defaults: { permission: "read-only", timeout: 30000, maxRows: 500 },
  };
  return { cm, config, backend };
}

describe("handleExplainQuery", () => {
  it("calls explainQuery without analyze by default", async () => {
    const { cm, config, backend } = setup();
    await handleExplainQuery(config, cm, {
      connection: "test",
      query: "SELECT * FROM users",
    });
    expect(backend.explainQuery).toHaveBeenCalledWith("test", "SELECT * FROM users", undefined);
  });

  it("passes analyze=true to backend", async () => {
    const { cm, config, backend } = setup();
    backend.explainQuery.mockResolvedValue(mockAnalyzeResult);
    await handleExplainQuery(config, cm, {
      connection: "test",
      query: "SELECT * FROM users",
      analyze: true,
    });
    expect(backend.explainQuery).toHaveBeenCalledWith("test", "SELECT * FROM users", true);
  });

  it("returns summary and plan from result", async () => {
    const { cm, config } = setup();
    const result = await handleExplainQuery(config, cm, {
      connection: "test",
      query: "SELECT * FROM users",
    });
    expect(result.summary).toHaveLength(1);
    expect(result.plan).toHaveLength(1);
    expect(result.columns).toEqual(["QUERY PLAN"]);
  });
});
