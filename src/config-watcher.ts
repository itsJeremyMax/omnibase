import { watch, type FSWatcher } from "fs";
import { loadConfig } from "./config.js";
import { validateCustomTools } from "./custom-tools.js";
import type { OmnibaseConfig } from "./types.js";

const DEBOUNCE_MS = 500;

export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private configPath: string,
    private onChange: (config: OmnibaseConfig) => void,
    private onError: (error: Error) => void,
  ) {}

  start(): void {
    this.watcher = watch(this.configPath, () => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => this.handleChange(), DEBOUNCE_MS);
    });
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private handleChange(): void {
    try {
      const config = loadConfig(this.configPath);
      validateCustomTools(config);
      this.onChange(config);
    } catch (err) {
      this.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
