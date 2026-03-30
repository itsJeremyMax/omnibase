import { describe, it, expect } from "vitest";
import type { CustomToolParameter, CustomToolConfig, OmnibaseConfig } from "../src/types.js";

describe("CustomToolConfig types", () => {
  it("accepts a valid custom tool config shape", () => {
    const param: CustomToolParameter = {
      type: "enum",
      description: "Order status",
      required: true,
      values: ["pending", "shipped"],
    };

    const tool: CustomToolConfig = {
      connection: "my-db",
      description: "Find orders by status",
      sql: "SELECT * FROM orders WHERE status = {status}",
      parameters: { status: param },
    };

    expect(tool.connection).toBe("my-db");
    expect(tool.parameters!.status.type).toBe("enum");
  });

  it("accepts optional fields on custom tool config", () => {
    const tool: CustomToolConfig = {
      connection: "my-db",
      description: "Get active users",
      sql: "SELECT * FROM users WHERE active = true",
      permission: "read-write",
      maxRows: 100,
      timeout: 5000,
    };

    expect(tool.permission).toBe("read-write");
    expect(tool.maxRows).toBe(100);
    expect(tool.timeout).toBe(5000);
  });

  it("accepts optional parameter with default", () => {
    const param: CustomToolParameter = {
      type: "number",
      description: "Minimum amount",
      required: false,
      default: 0,
    };

    expect(param.required).toBe(false);
    expect(param.default).toBe(0);
  });
});
