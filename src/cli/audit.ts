import pc from "picocolors";
import { createReadStream, existsSync, truncateSync, statSync } from "fs";
import { createInterface } from "readline";
import { resolve } from "path";
import { loadConfig, resolveConfigPath } from "../config.js";

function getLogPath(): string {
  const configPath = resolveConfigPath(process.cwd());
  if (configPath) {
    const config = loadConfig(configPath);
    if (config.audit?.path) {
      return resolve(config.audit.path);
    }
  }
  return resolve(process.cwd(), ".omnibase", "audit.log");
}

function formatLine(raw: string): string {
  try {
    const entry = JSON.parse(raw);
    const status = entry.status === "ok" ? pc.green("ok") : pc.red("error");
    const duration = pc.dim(`${entry.duration_ms}ms`);
    const rows = pc.dim(`${entry.rows} row${entry.rows === 1 ? "" : "s"}`);
    const ts = pc.dim(entry.ts);
    const tool = pc.cyan(entry.tool);
    const conn = pc.yellow(entry.connection);
    const sql = entry.sql.length > 80 ? entry.sql.slice(0, 77) + "..." : entry.sql;
    const errorPart = entry.error ? ` ${pc.red(entry.error)}` : "";
    return `${ts} [${status}] ${tool} @ ${conn} ${duration} ${rows}\n  ${pc.dim(sql)}${errorPart}`;
  } catch {
    return raw;
  }
}

async function printLines(
  filePath: string,
  filter: ((line: string) => boolean) | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      if (filter && !filter(line)) return;
      console.log(formatLine(line));
    });
    rl.on("close", resolve);
    rl.on("error", reject);
  });
}

async function printLinesFrom(filePath: string, startByte: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { start: startByte, encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      console.log(formatLine(line));
    });
    rl.on("close", resolve);
    rl.on("error", reject);
  });
}

async function tail(): Promise<void> {
  const logPath = getLogPath();
  if (!existsSync(logPath)) {
    console.log(pc.dim(`No audit log found at ${logPath}`));
    console.log(pc.dim("Enable audit logging with: audit: { enabled: true } in your config."));
    return;
  }

  console.log(pc.dim(`Tailing ${logPath} — press Ctrl+C to stop\n`));
  await printLines(logPath, null);

  let lastSize = statSync(logPath).size;
  const interval = setInterval(async () => {
    try {
      const currentSize = statSync(logPath).size;
      if (currentSize > lastSize) {
        await printLinesFrom(logPath, lastSize);
        lastSize = currentSize;
      }
    } catch {}
  }, 500);

  process.on("SIGINT", () => {
    clearInterval(interval);
    process.exit(0);
  });

  await new Promise(() => {});
}

async function search(query: string): Promise<void> {
  if (!query) {
    console.error(pc.red("Usage: omnibase-mcp audit search <query>"));
    process.exit(1);
  }

  const logPath = getLogPath();
  if (!existsSync(logPath)) {
    console.log(pc.dim(`No audit log found at ${logPath}`));
    return;
  }

  const lowerQuery = query.toLowerCase();
  let matchCount = 0;

  await new Promise<void>((resolve, reject) => {
    const rl = createInterface({
      input: createReadStream(logPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      if (line.toLowerCase().includes(lowerQuery)) {
        matchCount++;
        console.log(formatLine(line));
      }
    });
    rl.on("close", resolve);
    rl.on("error", reject);
  });

  if (matchCount === 0) {
    console.log(pc.dim(`No entries matching "${query}"`));
  } else {
    console.log(pc.dim(`\n${matchCount} matching entries`));
  }
}

async function clear(): Promise<void> {
  const logPath = getLogPath();
  if (!existsSync(logPath)) {
    console.log(pc.dim("No audit log to clear."));
    return;
  }

  const p = await import("@clack/prompts");
  const confirmed = await p.confirm({
    message: `Clear audit log at ${logPath}?`,
    initialValue: false,
  });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  truncateSync(logPath, 0);
  console.log(pc.green("Audit log cleared."));
}

export const audit = { tail, search, clear };
