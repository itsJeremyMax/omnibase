import { describe, it, expect } from "vitest";
import { classifyQuery, isMultiStatement } from "../src/query-analyzer.js";

describe("classifyQuery", () => {
  // Read queries
  it("classifies SELECT as read", () => {
    expect(classifyQuery("SELECT * FROM users")).toBe("read");
  });

  it("classifies SELECT with CTE as read", () => {
    expect(
      classifyQuery(
        "WITH active AS (SELECT * FROM users WHERE active = true) SELECT * FROM active",
      ),
    ).toBe("read");
  });

  it("classifies SELECT with subquery as read", () => {
    expect(classifyQuery("SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)")).toBe(
      "read",
    );
  });

  it("classifies EXPLAIN as read", () => {
    expect(classifyQuery("EXPLAIN SELECT * FROM users")).toBe("read");
  });

  it("classifies EXPLAIN of DELETE as read", () => {
    expect(classifyQuery("EXPLAIN DELETE FROM users WHERE id = 1")).toBe("read");
  });

  // Write queries
  it("classifies INSERT as write", () => {
    expect(classifyQuery("INSERT INTO users (name) VALUES ('alice')")).toBe("write");
  });

  it("classifies UPDATE as write", () => {
    expect(classifyQuery("UPDATE users SET name = 'bob' WHERE id = 1")).toBe("write");
  });

  it("classifies DELETE as write", () => {
    expect(classifyQuery("DELETE FROM users WHERE id = 1")).toBe("write");
  });

  // DDL queries
  it("classifies CREATE TABLE as ddl", () => {
    expect(classifyQuery("CREATE TABLE users (id INT)")).toBe("ddl");
  });

  it("classifies ALTER TABLE as ddl", () => {
    expect(classifyQuery("ALTER TABLE users ADD COLUMN email TEXT")).toBe("ddl");
  });

  it("classifies DROP TABLE as ddl", () => {
    expect(classifyQuery("DROP TABLE users")).toBe("ddl");
  });

  it("classifies CREATE INDEX as ddl", () => {
    expect(classifyQuery("CREATE INDEX idx_name ON users(name)")).toBe("ddl");
  });

  // Edge cases
  it("classifies CALL as write (conservative)", () => {
    expect(classifyQuery("CALL my_procedure()")).toBe("write");
  });

  it("handles leading whitespace and comments", () => {
    expect(classifyQuery("  -- comment\n  SELECT * FROM users")).toBe("read");
  });

  it("classifies unknown statements as write (fail safe)", () => {
    expect(classifyQuery("VACUUM")).toBe("write");
  });

  it("is case insensitive", () => {
    expect(classifyQuery("select * from users")).toBe("read");
    expect(classifyQuery("INSERT into users values (1)")).toBe("write");
  });
});

describe("isMultiStatement", () => {
  it("returns false for single statement", () => {
    expect(isMultiStatement("SELECT * FROM users")).toBe(false);
  });

  it("returns true for multiple statements", () => {
    expect(isMultiStatement("SELECT 1; DROP TABLE users")).toBe(true);
  });

  it("ignores semicolons in strings", () => {
    expect(isMultiStatement("SELECT 'hello; world' FROM users")).toBe(false);
  });

  it("returns false for trailing semicolon", () => {
    expect(isMultiStatement("SELECT * FROM users;")).toBe(false);
  });
});
