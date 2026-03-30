import { describe, it, expect, vi, afterEach } from "vitest";
import { ConfigWatcher } from "../src/config-watcher.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("ConfigWatcher", () => {
  const tempDir = join(tmpdir(), "omnibase-watcher-test-" + Date.now());
  const configPath = join(tempDir, "config.yaml");

  const validConfig = `
connections:
  my-db:
    dsn: sqlite:./test.db
`;

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true });
    } catch {}
  });

  it("calls onChange when config file is modified", async () => {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(configPath, validConfig);

    const onChange = vi.fn();
    const onError = vi.fn();
    const watcher = new ConfigWatcher(configPath, onChange, onError);
    watcher.start();

    // Give the watcher a moment to register before writing
    await new Promise((r) => setTimeout(r, 100));

    // Modify the file
    writeFileSync(configPath, validConfig + "\n# changed");

    // Wait for debounce (500ms) + buffer
    await new Promise((r) => setTimeout(r, 800));

    expect(onChange).toHaveBeenCalled();
    watcher.stop();
  });

  it("calls onError when config is invalid", async () => {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(configPath, validConfig);

    const onChange = vi.fn();
    const onError = vi.fn();
    const watcher = new ConfigWatcher(configPath, onChange, onError);
    watcher.start();

    // Give the watcher a moment to register before writing
    await new Promise((r) => setTimeout(r, 100));

    // Write invalid config (missing connections entirely)
    writeFileSync(configPath, "connections:\n  bad:\n    no_dsn: true\n");

    await new Promise((r) => setTimeout(r, 800));

    expect(onError).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    watcher.stop();
  });

  it("can be stopped", () => {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(configPath, validConfig);

    const watcher = new ConfigWatcher(configPath, vi.fn(), vi.fn());
    watcher.start();
    watcher.stop();
  });
});
