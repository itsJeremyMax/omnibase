import pc from "picocolors";
import Table from "cli-table3";
import { loadConfig, resolveConfigPath } from "../config.js";
import { startSidecar } from "./sidecar-utils.js";
import type { OmnibaseConfig } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";

const DSN_TYPE_MAP: Record<string, string> = {
  pg: "postgres",
  postgres: "postgres",
  my: "mysql",
  mysql: "mysql",
  sqlite: "sqlite",
};

export function detectDbType(dsn: string): string {
  const prefix = dsn.split(":")[0].toLowerCase();
  return DSN_TYPE_MAP[prefix] ?? prefix;
}

export interface PingResult {
  name: string;
  dbType: string;
  permission: string;
  latencyMs: number | null;
  status: "ok" | "error";
  error?: string;
}

export async function pingAllConnections(
  config: OmnibaseConfig,
  cm: ConnectionManager,
): Promise<PingResult[]> {
  const entries = Object.values(config.connections);

  const settled = await Promise.allSettled(
    entries.map(async (conn) => {
      const start = Date.now();
      await cm.ping(conn);
      return Date.now() - start;
    }),
  );

  return entries.map((conn, i) => {
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      return {
        name: conn.name,
        dbType: detectDbType(conn.dsn),
        permission: conn.permission,
        latencyMs: outcome.value,
        status: "ok" as const,
      };
    } else {
      const err = outcome.reason;
      return {
        name: conn.name,
        dbType: detectDbType(conn.dsn),
        permission: conn.permission,
        latencyMs: null,
        status: "error" as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

export function renderDashboard(results: PingResult[]): void {
  const table = new Table({
    head: [
      pc.bold("Connection"),
      pc.bold("Type"),
      pc.bold("Permission"),
      pc.bold("Latency"),
      pc.bold("Status"),
    ],
  });

  for (const r of results) {
    const latency = r.latencyMs !== null ? `${r.latencyMs}ms` : "--";
    if (r.status === "ok") {
      table.push([r.name, r.dbType, r.permission, latency, pc.green("ok")]);
    } else {
      table.push([
        r.name,
        r.dbType,
        r.permission,
        latency,
        pc.red(`error: ${r.error ?? "unknown"}`),
      ]);
    }
  }

  console.log(table.toString());
}

export async function runStatus(): Promise<void> {
  const configPath = resolveConfigPath(process.cwd());
  if (!configPath) {
    console.error(
      pc.red("No omnibase.config.yaml found. Run `npx omnibase-mcp@latest init` to create one."),
    );
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const connectionCount = Object.keys(config.connections).length;

  if (connectionCount === 0) {
    console.log(pc.dim("No connections configured."));
    return;
  }

  console.log(pc.dim(`Pinging ${connectionCount} connection(s)...`));

  const { sidecar, cm } = await startSidecar();
  try {
    const results = await pingAllConnections(config, cm);
    renderDashboard(results);

    const errorCount = results.filter((r) => r.status === "error").length;
    if (errorCount > 0) {
      console.log(pc.red(`\n${errorCount} connection(s) failed.`));
    } else {
      console.log(pc.green("\nAll connections ok."));
    }
  } finally {
    await sidecar.stop();
  }
}
