import { describe, it, expect } from "vitest";
import { extractComposeReferences, expandComposeReferences } from "../src/compose-expander.js";
import type { QueryResult } from "../src/types.js";

describe("extractComposeReferences", () => {
  it("extracts step.col patterns", () => {
    const refs = extractComposeReferences("SELECT * FROM orders WHERE user_id IN ({users.id})");
    expect(refs).toEqual([{ step: "users", column: "id" }]);
  });

  it("ignores plain {param} placeholders (no dot)", () => {
    const refs = extractComposeReferences("SELECT * FROM orders WHERE status = {status}");
    expect(refs).toEqual([]);
  });

  it("extracts multiple references", () => {
    const refs = extractComposeReferences(
      "SELECT * FROM t WHERE a IN ({s1.id}) AND b IN ({s2.name})",
    );
    expect(refs).toEqual([
      { step: "s1", column: "id" },
      { step: "s2", column: "name" },
    ]);
  });

  it("deduplicates repeated references", () => {
    const refs = extractComposeReferences("SELECT * FROM t WHERE a IN ({s1.id}) OR b IN ({s1.id})");
    expect(refs).toEqual([{ step: "s1", column: "id" }]);
  });
});

describe("expandComposeReferences", () => {
  function makeResult(columns: string[], rows: unknown[][]): QueryResult {
    return { columns, rows, rowCount: rows.length, hasMore: false };
  }

  it("expands numeric values inline", () => {
    const context = new Map<string, QueryResult>();
    context.set("users", makeResult(["id"], [[1], [2], [3]]));

    const result = expandComposeReferences(
      "SELECT * FROM orders WHERE user_id IN ({users.id})",
      context,
    );
    expect(result).toBe("SELECT * FROM orders WHERE user_id IN (1, 2, 3)");
  });

  it("expands string values with quoting", () => {
    const context = new Map<string, QueryResult>();
    context.set("cats", makeResult(["name"], [["tabby"], ["persian"]]));

    const result = expandComposeReferences(
      "SELECT * FROM pets WHERE breed IN ({cats.name})",
      context,
    );
    expect(result).toBe("SELECT * FROM pets WHERE breed IN ('tabby', 'persian')");
  });

  it("escapes single quotes in strings", () => {
    const context = new Map<string, QueryResult>();
    context.set("items", makeResult(["label"], [["it's"]]));

    const result = expandComposeReferences(
      "SELECT * FROM t WHERE label IN ({items.label})",
      context,
    );
    expect(result).toBe("SELECT * FROM t WHERE label IN ('it''s')");
  });

  it("throws on missing step", () => {
    const context = new Map<string, QueryResult>();
    expect(() =>
      expandComposeReferences("SELECT * FROM t WHERE id IN ({missing.id})", context),
    ).toThrow("step 'missing' not found");
  });

  it("throws on missing column", () => {
    const context = new Map<string, QueryResult>();
    context.set("users", makeResult(["id"], [[1]]));

    expect(() =>
      expandComposeReferences("SELECT * FROM t WHERE name IN ({users.name})", context),
    ).toThrow("column 'name' not found");
  });

  it("throws on empty result set", () => {
    const context = new Map<string, QueryResult>();
    context.set("users", makeResult(["id"], []));

    expect(() =>
      expandComposeReferences("SELECT * FROM t WHERE id IN ({users.id})", context),
    ).toThrow("returned no rows");
  });

  it("throws on unsupported type", () => {
    const context = new Map<string, QueryResult>();
    context.set("users", makeResult(["data"], [[{ foo: "bar" }]]));

    expect(() =>
      expandComposeReferences("SELECT * FROM t WHERE d IN ({users.data})", context),
    ).toThrow("unsupported type");
  });

  it("passes through SQL with no compose references", () => {
    const context = new Map<string, QueryResult>();
    const sql = "SELECT * FROM orders WHERE status = ?";
    expect(expandComposeReferences(sql, context)).toBe(sql);
  });
});
