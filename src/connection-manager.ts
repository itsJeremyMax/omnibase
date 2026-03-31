import type {
  ConnectionConfig,
  ConnectionStatus,
  DatabaseBackend,
  QueryResult,
  SchemaInfo,
  ExecuteOptions,
} from "./types.js";

export class ConnectionManager {
  private connectedIds = new Set<string>();
  private schemaCache = new Map<string, SchemaInfo>();
  private statusMap = new Map<string, ConnectionStatus>();
  private transactionLocks = new Map<string, Promise<void>>();

  constructor(private backend: DatabaseBackend) {}

  async ensureConnected(config: ConnectionConfig): Promise<void> {
    if (this.connectedIds.has(config.name)) return;

    try {
      await this.backend.connect(config.name, config.dsn);
      this.connectedIds.add(config.name);
      this.statusMap.set(config.name, "connected");
    } catch (err) {
      this.statusMap.set(config.name, "error");
      throw err;
    }
  }

  async execute(
    config: ConnectionConfig,
    query: string,
    params?: unknown[],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    await this.ensureConnected(config);
    return this.backend.execute(config.name, query, params, {
      maxRows: options?.maxRows ?? config.maxRows,
      timeoutMs: options?.timeoutMs ?? config.timeout,
    });
  }

  async getSchema(
    config: ConnectionConfig,
    options?: { forceRefresh?: boolean; exactCounts?: boolean },
  ): Promise<SchemaInfo> {
    await this.ensureConnected(config);

    const forceRefresh = options?.forceRefresh ?? false;
    const exactCounts = options?.exactCounts;

    // Only use cache when exact_counts is not explicitly requested
    // (cache may contain estimates or exact counts from a previous call)
    if (!forceRefresh && exactCounts === undefined && this.schemaCache.has(config.name)) {
      return this.schemaCache.get(config.name)!;
    }

    const schema = await this.backend.getSchema(
      config.name,
      config.schemaFilter
        ? {
            schemas: config.schemaFilter.schemas,
            tables: config.schemaFilter.tables,
            exactCounts,
          }
        : exactCounts !== undefined
          ? { exactCounts }
          : undefined,
    );

    this.schemaCache.set(config.name, schema);
    return schema;
  }

  async explainQuery(config: ConnectionConfig, query: string): Promise<QueryResult> {
    await this.ensureConnected(config);
    return this.backend.explainQuery(config.name, query);
  }

  async validateQuery(
    config: ConnectionConfig,
    query: string,
  ): Promise<{ valid: boolean; error?: string }> {
    await this.ensureConnected(config);
    return this.backend.validateQuery(config.name, query);
  }

  invalidateSchemaCache(connectionName: string): void {
    this.schemaCache.delete(connectionName);
  }

  getStatus(connectionName: string): ConnectionStatus {
    return this.statusMap.get(connectionName) ?? "available";
  }

  async ping(config: ConnectionConfig): Promise<void> {
    await this.ensureConnected(config);
    await this.backend.ping(config.name);
  }

  async disconnect(config: ConnectionConfig): Promise<void> {
    await this.backend.disconnect(config.name);
    this.connectedIds.delete(config.name);
    this.schemaCache.delete(config.name);
    this.statusMap.set(config.name, "available");
  }

  // Called by SidecarClient when the sidecar process crashes.
  // Clears connection state so ensureConnected will re-establish on next use.
  // Schema cache is preserved (it lives here, not in the sidecar).
  handleSidecarCrash(): void {
    this.connectedIds.clear();
    for (const [name] of this.statusMap) {
      this.statusMap.set(name, "available");
    }
  }

  async disconnectAll(configs: ConnectionConfig[]): Promise<void> {
    for (const config of configs) {
      if (this.connectedIds.has(config.name)) {
        try {
          await this.disconnect(config);
        } catch {
          // Best effort on shutdown
        }
      }
    }
  }

  /**
   * Acquire an exclusive lock for transactional operations on a connection.
   * Returns a release function that must be called when the transaction is done.
   * Concurrent callers wait until the lock is released.
   */
  async acquireTransactionLock(connectionName: string): Promise<() => void> {
    // Wait for any existing lock to be released
    while (this.transactionLocks.has(connectionName)) {
      await this.transactionLocks.get(connectionName);
    }

    let release!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.transactionLocks.set(connectionName, lockPromise);

    return () => {
      this.transactionLocks.delete(connectionName);
      release();
    };
  }

  // Note: periodic heartbeat (ping) is not implemented in v0.1.
  // The sidecar handles connection-level reconnection internally via Go's
  // database/sql pool. Heartbeat can be added as an interval timer here
  // if stale connections become a problem in practice.
}
