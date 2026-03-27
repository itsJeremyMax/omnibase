import { describe, it, expect } from "vitest";
import {
  formatQueryResult,
  formatSchemaResult,
  formatSearchResults,
} from "../src/output-formatter.js";
import type { QueryResult, SchemaInfo, TableInfo } from "../src/types.js";

describe("formatQueryResult", () => {
  it("passes through results under the limit", () => {
    const result: QueryResult = {
      columns: ["id", "name"],
      rows: [
        [1, "alice"],
        [2, "bob"],
      ],
      rowCount: 2,
      hasMore: false,
    };
    const formatted = formatQueryResult(result, 500);
    expect(formatted.truncated).toBe(false);
    expect(formatted.row_count).toBe(2);
    expect(formatted.rows).toEqual([
      [1, "alice"],
      [2, "bob"],
    ]);
  });

  it("marks truncated when hasMore is true", () => {
    const result: QueryResult = {
      columns: ["id"],
      rows: [[1], [2], [3]],
      rowCount: 3,
      hasMore: true,
    };
    const formatted = formatQueryResult(result, 500);
    expect(formatted.truncated).toBe(true);
  });

  it("truncates long string values", () => {
    const longString = "x".repeat(600);
    const result: QueryResult = {
      columns: ["data"],
      rows: [[longString]],
      rowCount: 1,
      hasMore: false,
    };
    const formatted = formatQueryResult(result, 500);
    const value = formatted.rows[0][0] as string;
    expect(value.length).toBeLessThan(600);
    expect(value).toContain("...[truncated]");
  });

  it("renders null as null, not empty string", () => {
    const result: QueryResult = {
      columns: ["name"],
      rows: [[null]],
      rowCount: 1,
      hasMore: false,
    };
    const formatted = formatQueryResult(result, 500);
    expect(formatted.rows[0][0]).toBeNull();
  });
});

describe("formatSchemaResult", () => {
  const fullTable: TableInfo = {
    name: "users",
    schema: "public",
    columns: [
      {
        name: "id",
        type: "INTEGER",
        nullable: false,
        defaultValue: null,
        isPrimaryKey: true,
        comment: null,
      },
      {
        name: "name",
        type: "TEXT",
        nullable: false,
        defaultValue: null,
        isPrimaryKey: false,
        comment: null,
      },
    ],
    primaryKey: ["id"],
    indexes: [],
    foreignKeys: [],
    rowCountEstimate: 1000,
    comment: null,
  };

  it("returns summary mode when no specific tables requested", () => {
    const schema: SchemaInfo = { tables: [fullTable] };
    const result = formatSchemaResult(schema, false);
    // Summary should not include full column details
    expect(result.tables[0]).toHaveProperty("name");
    expect(result.tables[0]).toHaveProperty("column_count");
    expect(result.tables[0]).not.toHaveProperty("columns");
  });

  it("returns full mode when specific tables requested", () => {
    const schema: SchemaInfo = { tables: [fullTable] };
    const result = formatSchemaResult(schema, true);
    expect(result.tables[0]).toHaveProperty("columns");
  });
});

describe("formatSearchResults", () => {
  it("caps results at 20", () => {
    const tables: TableInfo[] = Array.from({ length: 30 }, (_, i) => ({
      name: `table_${i}`,
      schema: "public",
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
      rowCountEstimate: 0,
      comment: null,
    }));

    const results = formatSearchResults(tables, "table");
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it("ranks exact matches first", () => {
    const tables: TableInfo[] = [
      {
        name: "user_settings",
        schema: "public",
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
        rowCountEstimate: 0,
        comment: null,
      },
      {
        name: "users",
        schema: "public",
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
        rowCountEstimate: 0,
        comment: null,
      },
    ];

    const results = formatSearchResults(tables, "users");
    expect(results[0].tableName).toBe("users");
  });
});
