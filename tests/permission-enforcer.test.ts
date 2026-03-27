import { describe, it, expect } from "vitest";
import { enforcePermission } from "../src/permission-enforcer.js";

describe("enforcePermission", () => {
  // read-only connections
  it("allows read on read-only", () => {
    expect(() => enforcePermission("conn", "read-only", "read")).not.toThrow();
  });

  it("rejects write on read-only", () => {
    expect(() => enforcePermission("conn", "read-only", "write")).toThrow("read-only");
  });

  it("rejects ddl on read-only", () => {
    expect(() => enforcePermission("conn", "read-only", "ddl")).toThrow("read-only");
  });

  // read-write connections
  it("allows read on read-write", () => {
    expect(() => enforcePermission("conn", "read-write", "read")).not.toThrow();
  });

  it("allows write on read-write", () => {
    expect(() => enforcePermission("conn", "read-write", "write")).not.toThrow();
  });

  it("rejects ddl on read-write", () => {
    expect(() => enforcePermission("conn", "read-write", "ddl")).toThrow("read-write");
  });

  // admin connections
  it("allows read on admin", () => {
    expect(() => enforcePermission("conn", "admin", "read")).not.toThrow();
  });

  it("allows write on admin", () => {
    expect(() => enforcePermission("conn", "admin", "write")).not.toThrow();
  });

  it("allows ddl on admin", () => {
    expect(() => enforcePermission("conn", "admin", "ddl")).not.toThrow();
  });
});
