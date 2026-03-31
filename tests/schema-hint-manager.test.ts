import { describe, it, expect } from "vitest";
import { SchemaHintManager, formatTables } from "../src/schema-hint-manager.js";
import type { SchemaInfo, TableInfo } from "../src/types.js";

function makeTable(name: string, colNames: string[]): TableInfo {
  return {
    name,
    schema: "public",
    columns: colNames.map((c) => ({
      name: c,
      type: "text",
      nullable: true,
      defaultValue: null,
      isPrimaryKey: false,
      comment: null,
    })),
    primaryKey: [],
    indexes: [],
    foreignKeys: [],
    rowCountEstimate: 0,
    exactCount: false,
    comment: null,
  };
}

describe("formatTables", () => {
  it("formats a small schema", () => {
    const tables = [
      makeTable("users", ["id", "name", "email"]),
      makeTable("tasks", ["id", "title", "status"]),
    ];
    expect(formatTables(tables)).toBe("tasks (id, title, status), users (id, name, email)");
  });

  it("truncates columns beyond limit with ...", () => {
    const cols = Array.from({ length: 15 }, (_, i) => `col${i}`);
    expect(formatTables([makeTable("big", cols)])).toContain("...");
  });

  it("shows +N more tables when exceeding MAX_TABLES", () => {
    const tables = Array.from({ length: 25 }, (_, i) => makeTable(`table${i}`, ["id"]));
    expect(formatTables(tables)).toContain("+5 more tables");
  });
});

describe("SchemaHintManager", () => {
  it("does nothing when disabled", () => {
    const mgr = new SchemaHintManager(false);
    const updates: string[] = [];
    mgr.registerTool({ update: ({ description }) => updates.push(description ?? "") }, "Base.");
    mgr.updateHints("db", { tables: [makeTable("users", ["id"])] });
    expect(updates).toHaveLength(0);
  });

  it("appends schema hint to base description", () => {
    const mgr = new SchemaHintManager(true);
    const updates: string[] = [];
    mgr.registerTool(
      { update: ({ description }) => updates.push(description ?? "") },
      "Execute a SQL query.",
    );
    mgr.updateHints("db", { tables: [makeTable("users", ["id", "name"])] });
    expect(updates[0]).toContain("Execute a SQL query.");
    expect(updates[0]).toContain("Available tables:");
    expect(updates[0]).toContain("users (id, name)");
  });

  it("updates all registered tools", () => {
    const mgr = new SchemaHintManager(true);
    const u1: string[] = [],
      u2: string[] = [];
    mgr.registerTool({ update: ({ description }) => u1.push(description ?? "") }, "Tool 1.");
    mgr.registerTool({ update: ({ description }) => u2.push(description ?? "") }, "Tool 2.");
    mgr.updateHints("db", { tables: [makeTable("orders", ["id"])] });
    expect(u1[0]).toContain("orders");
    expect(u2[0]).toContain("orders");
  });

  it("prefixes connection name with multiple connections", () => {
    const mgr = new SchemaHintManager(true);
    const updates: string[] = [];
    mgr.registerTool({ update: ({ description }) => updates.push(description ?? "") }, "Base.");
    mgr.updateHints("db1", { tables: [makeTable("users", ["id"])] });
    mgr.updateHints("db2", { tables: [makeTable("products", ["id"])] });
    const last = updates[updates.length - 1];
    expect(last).toContain("db1:");
    expect(last).toContain("db2:");
  });

  it("buildHint returns empty string with no schemas", () => {
    expect(new SchemaHintManager(true).buildHint()).toBe("");
  });

  it("truncates hint to fit within MAX_HINT_LENGTH", () => {
    const mgr = new SchemaHintManager(true);
    mgr.registerTool({ update: () => {} }, "Base.");
    const tables = Array.from({ length: 30 }, (_, i) =>
      makeTable(
        `table_${i}`,
        Array.from({ length: 15 }, (_, j) => `column_${j}`),
      ),
    );
    mgr.updateHints("bigdb", { tables });
    expect(mgr.buildHint().length).toBeLessThanOrEqual(800);
  });
});
