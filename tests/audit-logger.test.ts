import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { AuditLogger } from "../src/audit-logger.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "audit-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("AuditLogger", () => {
  it("does nothing when disabled", async () => {
    const logPath = join(tmpDir, "audit.log");
    const logger = new AuditLogger({
      enabled: false,
      path: logPath,
      format: "jsonl",
      maxEntries: 10000,
    });
    await logger.log({
      tool: "execute_sql",
      connection: "db",
      sql: "SELECT 1",
      params: [],
      durationMs: 5,
      rows: 1,
      status: "ok",
    });
    expect(existsSync(logPath)).toBe(false);
  });

  it("writes a JSONL entry when enabled", async () => {
    const logPath = join(tmpDir, "audit.log");
    const logger = new AuditLogger({
      enabled: true,
      path: logPath,
      format: "jsonl",
      maxEntries: 10000,
    });
    await logger.log({
      tool: "execute_sql",
      connection: "app-db",
      sql: "SELECT COUNT(*) FROM users",
      params: [],
      durationMs: 12,
      rows: 1,
      status: "ok",
    });
    const entry = JSON.parse(readFileSync(logPath, "utf-8").trim());
    expect(entry.tool).toBe("execute_sql");
    expect(entry.duration_ms).toBe(12);
    expect(typeof entry.ts).toBe("string");
  });

  it("writes text format", async () => {
    const logPath = join(tmpDir, "audit.log");
    const logger = new AuditLogger({
      enabled: true,
      path: logPath,
      format: "text",
      maxEntries: 10000,
    });
    await logger.log({
      tool: "custom_count",
      connection: "db",
      sql: "SELECT 1",
      params: [],
      durationMs: 8,
      rows: 1,
      status: "ok",
    });
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("custom_count");
    expect(content).toContain("OK");
  });

  it("appends multiple entries", async () => {
    const logPath = join(tmpDir, "audit.log");
    const logger = new AuditLogger({
      enabled: true,
      path: logPath,
      format: "jsonl",
      maxEntries: 10000,
    });
    await logger.log({
      tool: "t",
      connection: "db",
      sql: "SELECT 1",
      params: [],
      durationMs: 1,
      rows: 0,
      status: "ok",
    });
    await logger.log({
      tool: "t",
      connection: "db",
      sql: "SELECT 2",
      params: [],
      durationMs: 2,
      rows: 0,
      status: "ok",
    });
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("logs error entries", async () => {
    const logPath = join(tmpDir, "audit.log");
    const logger = new AuditLogger({
      enabled: true,
      path: logPath,
      format: "jsonl",
      maxEntries: 10000,
    });
    await logger.log({
      tool: "t",
      connection: "db",
      sql: "BAD",
      params: [],
      durationMs: 3,
      rows: 0,
      status: "error",
      error: "syntax error",
    });
    const entry = JSON.parse(readFileSync(logPath, "utf-8").trim());
    expect(entry.status).toBe("error");
    expect(entry.error).toBe("syntax error");
  });

  it("creates parent directories", async () => {
    const logPath = join(tmpDir, "nested", "dir", "audit.log");
    const logger = new AuditLogger({
      enabled: true,
      path: logPath,
      format: "jsonl",
      maxEntries: 10000,
    });
    await logger.log({
      tool: "t",
      connection: "db",
      sql: "SELECT 1",
      params: [],
      durationMs: 1,
      rows: 0,
      status: "ok",
    });
    expect(existsSync(logPath)).toBe(true);
  });

  it("prunes entries when exceeding maxEntries", async () => {
    const logPath = join(tmpDir, "audit.log");
    const logger = new AuditLogger({
      enabled: true,
      path: logPath,
      format: "jsonl",
      maxEntries: 3,
    });
    for (let i = 0; i < 5; i++) {
      await logger.log({
        tool: "t",
        connection: "db",
        sql: `SELECT ${i}`,
        params: [],
        durationMs: 1,
        rows: 0,
        status: "ok",
      });
    }
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
    // Should keep the most recent 3
    expect(JSON.parse(lines[0]).sql).toBe("SELECT 2");
    expect(JSON.parse(lines[2]).sql).toBe("SELECT 4");
  });

  it("readEntries returns entries in reverse chronological order", async () => {
    const logPath = join(tmpDir, "audit.log");
    const logger = new AuditLogger({
      enabled: true,
      path: logPath,
      format: "jsonl",
      maxEntries: 10000,
    });
    await logger.log({
      tool: "t",
      connection: "db",
      sql: "SELECT 1",
      params: [],
      durationMs: 1,
      rows: 0,
      status: "ok",
    });
    await logger.log({
      tool: "t",
      connection: "db",
      sql: "SELECT 2",
      params: [],
      durationMs: 1,
      rows: 0,
      status: "ok",
    });
    const entries = await logger.readEntries();
    expect(entries[0].sql).toBe("SELECT 2");
    expect(entries[1].sql).toBe("SELECT 1");
  });

  it("readEntries filters by connection", async () => {
    const logPath = join(tmpDir, "audit.log");
    const logger = new AuditLogger({
      enabled: true,
      path: logPath,
      format: "jsonl",
      maxEntries: 10000,
    });
    await logger.log({
      tool: "t",
      connection: "db1",
      sql: "SELECT 1",
      params: [],
      durationMs: 1,
      rows: 0,
      status: "ok",
    });
    await logger.log({
      tool: "t",
      connection: "db2",
      sql: "SELECT 2",
      params: [],
      durationMs: 1,
      rows: 0,
      status: "ok",
    });
    const entries = await logger.readEntries({ connection: "db1" });
    expect(entries).toHaveLength(1);
    expect(entries[0].connection).toBe("db1");
  });

  it("readEntries filters by status", async () => {
    const logPath = join(tmpDir, "audit.log");
    const logger = new AuditLogger({
      enabled: true,
      path: logPath,
      format: "jsonl",
      maxEntries: 10000,
    });
    await logger.log({
      tool: "t",
      connection: "db",
      sql: "OK",
      params: [],
      durationMs: 1,
      rows: 0,
      status: "ok",
    });
    await logger.log({
      tool: "t",
      connection: "db",
      sql: "BAD",
      params: [],
      durationMs: 1,
      rows: 0,
      status: "error",
      error: "fail",
    });
    const entries = await logger.readEntries({ status: "error" });
    expect(entries).toHaveLength(1);
    expect(entries[0].sql).toBe("BAD");
  });

  it("readEntries supports offset pagination", async () => {
    const logPath = join(tmpDir, "audit.log");
    const logger = new AuditLogger({
      enabled: true,
      path: logPath,
      format: "jsonl",
      maxEntries: 10000,
    });
    for (let i = 0; i < 5; i++) {
      await logger.log({
        tool: "t",
        connection: "db",
        sql: `SELECT ${i}`,
        params: [],
        durationMs: 1,
        rows: 0,
        status: "ok",
      });
    }
    const page = await logger.readEntries({ limit: 2, offset: 2 });
    expect(page).toHaveLength(2);
    expect(page[0].sql).toBe("SELECT 2"); // 3rd most recent
    expect(page[1].sql).toBe("SELECT 1"); // 4th most recent
  });
});
