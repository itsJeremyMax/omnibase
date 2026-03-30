import { spawn, ChildProcess } from "child_process";
import { createInterface, Interface } from "readline";
import {
  DatabaseBackend,
  ExecuteOptions,
  QueryResult,
  SchemaFilter,
  SchemaInfo,
  JsonRpcRequest,
  JsonRpcResponse,
  OmnibaseError,
} from "./types.js";

export class SidecarClient implements DatabaseBackend {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private requestId = 0;
  private stopping = false;
  private onCrash?: () => void;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();

  constructor(private binaryPath: string) {}

  /** Register a callback for when the sidecar crashes (used by ConnectionManager to reset state). */
  setCrashHandler(handler: () => void): void {
    this.onCrash = handler;
  }

  async start(): Promise<void> {
    this.stopping = false;
    this.process = spawn(this.binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[sidecar] ${data}`);
    });

    this.process.on("exit", (_code) => {
      // Reject all pending requests
      for (const [, { reject }] of this.pending) {
        reject(new OmnibaseError("Sidecar process exited", "SIDECAR_CRASH"));
      }
      this.pending.clear();
      this.process = null;

      if (this.readline) {
        this.readline.close();
        this.readline = null;
      }

      // Notify crash handler (ConnectionManager resets connection state)
      if (!this.stopping && this.onCrash) {
        this.onCrash();
      }
    });

    this.readline = createInterface({ input: this.process.stdout! });
    this.readline.on("line", (line: string) => {
      this.handleResponse(line);
    });

    // Give sidecar a moment to start
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
  }

  private async ensureRunning(): Promise<void> {
    if (this.process && this.process.exitCode === null) return;
    // Sidecar is dead — respawn
    process.stderr.write("[sidecar] respawning after crash...\n");
    await this.start();
  }

  async connect(id: string, dsn: string): Promise<void> {
    await this.send("connect", { id, dsn });
  }

  async execute(
    id: string,
    query: string,
    params?: unknown[],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    const result = (await this.send("execute", {
      id,
      query,
      params: params ?? null,
      max_rows: options?.maxRows ?? 500,
      timeout_ms: options?.timeoutMs ?? 30000,
    })) as {
      columns: string[];
      rows: unknown[][];
      row_count: number;
      has_more: boolean;
      affected_rows?: number;
      last_insert_id?: number;
    };
    // Map snake_case sidecar response to camelCase TypeScript interface
    return {
      columns: result.columns ?? [],
      rows: result.rows ?? [],
      rowCount: result.row_count,
      hasMore: result.has_more,
      ...(result.affected_rows != null ? { affectedRows: result.affected_rows } : {}),
      ...(result.last_insert_id != null ? { lastInsertId: result.last_insert_id } : {}),
    };
  }

  async getSchema(id: string, filter?: SchemaFilter): Promise<SchemaInfo> {
    const result = (await this.send("schema", {
      id,
      schemas: filter?.schemas ?? null,
      tables: filter?.tables ?? null,
      exact_counts: filter?.exactCounts ?? null,
    })) as { tables: Record<string, unknown>[] };

    // Map snake_case sidecar response to camelCase TypeScript types
    return {
      tables: (result.tables ?? []).map((t: Record<string, unknown>) => ({
        name: t.name as string,
        schema: t.schema as string,
        columns: ((t.columns as Record<string, unknown>[] | null) ?? []).map(
          (c: Record<string, unknown>) => ({
            name: c.name as string,
            type: c.type as string,
            nullable: c.nullable as boolean,
            defaultValue: (c.default_value as string | null) ?? null,
            isPrimaryKey: (c.is_primary_key as boolean) ?? false,
            comment: (c.comment as string | null) ?? null,
          }),
        ),
        primaryKey: (t.primary_key as string[] | null) ?? [],
        indexes: ((t.indexes as Record<string, unknown>[] | null) ?? []).map(
          (i: Record<string, unknown>) => ({
            name: i.name as string,
            columns: (i.columns as string[]) ?? [],
            unique: (i.unique as boolean) ?? false,
          }),
        ),
        foreignKeys: ((t.foreign_keys as Record<string, unknown>[] | null) ?? []).map(
          (fk: Record<string, unknown>) => ({
            column: fk.column as string,
            referencesTable: fk.references_table as string,
            referencesColumn: fk.references_column as string,
          }),
        ),
        rowCountEstimate: (t.row_count_estimate as number) ?? 0,
        exactCount: (t.exact_count as boolean) ?? false,
        comment: (t.comment as string | null) ?? null,
      })),
    };
  }

  async explainQuery(id: string, query: string): Promise<QueryResult> {
    const result = (await this.send("explain", { id, query })) as {
      columns: string[];
      rows: unknown[][];
      row_count: number;
      has_more: boolean;
    };
    return {
      columns: result.columns ?? [],
      rows: result.rows ?? [],
      rowCount: result.row_count,
      hasMore: result.has_more,
    };
  }

  async validateQuery(id: string, query: string): Promise<{ valid: boolean; error?: string }> {
    const result = (await this.send("validate", { id, query })) as {
      valid: boolean;
      error?: string;
    };
    return result;
  }

  async ping(id: string): Promise<void> {
    await this.send("ping", { id });
  }

  async disconnect(id: string): Promise<void> {
    await this.send("disconnect", { id });
  }

  private async send(method: string, params: Record<string, unknown>): Promise<unknown> {
    await this.ensureRunning();

    if (!this.process?.stdin) {
      throw new OmnibaseError("Sidecar not running", "SIDECAR_NOT_RUNNING");
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  private handleResponse(line: string): void {
    let response: JsonRpcResponse;
    try {
      response = JSON.parse(line);
    } catch {
      return; // Ignore non-JSON lines (e.g., startup messages)
    }

    const pending = this.pending.get(response.id);
    if (!pending) return;

    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(
        new OmnibaseError(response.error.message, response.error.code, response.error.detail),
      );
    } else {
      pending.resolve(response.result);
    }
  }
}
