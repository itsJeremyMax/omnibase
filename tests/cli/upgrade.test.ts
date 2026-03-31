import { describe, it, expect, vi } from "vitest";
import { parseChangelog, formatChangelog, detectInstallMethod } from "../../src/cli/upgrade.js";
import { runUpgrade } from "../../src/cli/upgrade.js";
import type { UpgradeDeps } from "../../src/cli/upgrade.js";

const SAMPLE_CHANGELOG = `# Changelog

## [0.1.23](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.22...omnibase-mcp-v0.1.23) (2026-03-30)


### Bug Fixes

* include README in npm registry publish payload ([7f8d3ec](https://github.com/itsJeremyMax/omnibase/commit/7f8d3ec))
* make defaults section optional in config ([a05cf4a](https://github.com/itsJeremyMax/omnibase/commit/a05cf4a))

## [0.1.22](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.21...omnibase-mcp-v0.1.22) (2026-03-30)


### Features

* add exact_counts parameter to list_tables for accurate row counts ([8dd47d8](https://github.com/itsJeremyMax/omnibase/commit/8dd47d8))


### Bug Fixes

* update integration tests for exact_counts and add CI concurrency ([2a07923](https://github.com/itsJeremyMax/omnibase/commit/2a07923))

## [0.1.21](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.20...omnibase-mcp-v0.1.21) (2026-03-28)


### Features

* sidecar version management and improved onboarding ([0e60853](https://github.com/itsJeremyMax/omnibase/commit/0e60853))

## [0.1.20](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.19...omnibase-mcp-v0.1.20) (2026-03-28)


### Bug Fixes

* use correct release tag format in sidecar download URL ([6822aa6](https://github.com/itsJeremyMax/omnibase/commit/6822aa6))
`;

describe("parseChangelog", () => {
  it("extracts entries between two versions (upgrade)", () => {
    const entries = parseChangelog(SAMPLE_CHANGELOG, "0.1.21", "0.1.23");
    expect(entries).toHaveLength(2);
    expect(entries[0].version).toBe("0.1.23");
    expect(entries[1].version).toBe("0.1.22");
  });

  it("extracts entries for downgrade (shows what's being rolled back)", () => {
    const entries = parseChangelog(SAMPLE_CHANGELOG, "0.1.23", "0.1.21");
    expect(entries).toHaveLength(2);
    expect(entries[0].version).toBe("0.1.23");
    expect(entries[1].version).toBe("0.1.22");
  });

  it("returns empty array when versions are the same", () => {
    const entries = parseChangelog(SAMPLE_CHANGELOG, "0.1.23", "0.1.23");
    expect(entries).toHaveLength(0);
  });

  it("parses sections within an entry", () => {
    const entries = parseChangelog(SAMPLE_CHANGELOG, "0.1.21", "0.1.22");
    expect(entries).toHaveLength(1);
    expect(entries[0].version).toBe("0.1.22");
    expect(entries[0].date).toBe("2026-03-30");
    expect(entries[0].sections).toHaveLength(2);
    expect(entries[0].sections[0].heading).toBe("Features");
    expect(entries[0].sections[0].items).toEqual([
      "add exact_counts parameter to list_tables for accurate row counts",
    ]);
    expect(entries[0].sections[1].heading).toBe("Bug Fixes");
    expect(entries[0].sections[1].items).toEqual([
      "update integration tests for exact_counts and add CI concurrency",
    ]);
  });

  it("strips commit hashes from items", () => {
    const entries = parseChangelog(SAMPLE_CHANGELOG, "0.1.22", "0.1.23");
    for (const entry of entries) {
      for (const section of entry.sections) {
        for (const item of section.items) {
          expect(item).not.toMatch(/\([a-f0-9]+\)/);
        }
      }
    }
  });

  it("returns empty array when changelog text is empty", () => {
    expect(parseChangelog("", "0.1.21", "0.1.23")).toHaveLength(0);
  });
});

describe("formatChangelog", () => {
  it("formats upgrade changelog", () => {
    const entries = parseChangelog(SAMPLE_CHANGELOG, "0.1.21", "0.1.23");
    const output = formatChangelog(entries, { isDowngrade: false });
    expect(output).toContain("What's new:");
    expect(output).toContain("0.1.23 (2026-03-30)");
    expect(output).toContain("Bug Fixes");
    expect(output).toContain("include README in npm registry publish payload");
    expect(output).toContain("https://github.com/itsJeremyMax/omnibase/releases");
  });

  it("formats downgrade changelog", () => {
    const entries = parseChangelog(SAMPLE_CHANGELOG, "0.1.23", "0.1.21");
    const output = formatChangelog(entries, { isDowngrade: true });
    expect(output).toContain("Changes being rolled back:");
    expect(output).not.toContain("What's new:");
  });

  it("returns empty string for no entries", () => {
    expect(formatChangelog([], { isDowngrade: false })).toBe("");
  });
});

describe("detectInstallMethod", () => {
  it("detects global npm install", () => {
    const result = detectInstallMethod(
      "/usr/local/lib/node_modules/omnibase-mcp/dist/src/index.js",
      "/usr/local",
    );
    expect(result.type).toBe("global");
    if (result.type === "global") {
      expect(result.command("0.1.25")).toContain("npm install -g");
    }
  });

  it("detects npx execution", () => {
    const result = detectInstallMethod(
      "/home/user/.npm/_npx/abc123/node_modules/omnibase-mcp/dist/src/index.js",
      "/usr/local",
    );
    expect(result.type).toBe("npx");
    if (result.type === "npx") {
      expect(result.message).toContain("npx");
    }
  });

  it("falls back to local for other paths", () => {
    const result = detectInstallMethod(
      "/home/user/project/node_modules/omnibase-mcp/dist/src/index.js",
      "/usr/local",
    );
    expect(result.type).toBe("local");
    if (result.type === "local") {
      expect(result.message).toContain("package.json");
    }
  });
});

function makeUpgradeDeps(overrides?: Partial<UpgradeDeps>): UpgradeDeps {
  return {
    currentVersion: "0.1.21",
    fetchLatestVersion: vi.fn().mockResolvedValue("0.1.23"),
    fetchVersionExists: vi.fn().mockResolvedValue(true),
    fetchChangelog: vi.fn().mockResolvedValue(""),
    detectInstall: vi.fn().mockReturnValue({
      type: "global" as const,
      command: (v: string) => `npm install -g omnibase-mcp@${v}`,
    }),
    execInstall: vi.fn().mockResolvedValue(undefined),
    verifyInstall: vi.fn().mockReturnValue("0.1.23"),
    log: vi.fn(),
    ...overrides,
  };
}

describe("runUpgrade", () => {
  it("shows already up to date when on latest", async () => {
    const deps = makeUpgradeDeps({ fetchLatestVersion: vi.fn().mockResolvedValue("0.1.21") });
    await runUpgrade({}, deps);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("Already up to date"));
  });

  it("blocks major upgrade without --allow-major", async () => {
    const deps = makeUpgradeDeps({ fetchLatestVersion: vi.fn().mockResolvedValue("1.0.0") });
    await runUpgrade({}, deps);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("major version change"));
    expect(deps.execInstall).not.toHaveBeenCalled();
  });

  it("allows major upgrade with --allow-major", async () => {
    const deps = makeUpgradeDeps({ fetchLatestVersion: vi.fn().mockResolvedValue("1.0.0") });
    await runUpgrade({ allowMajor: true }, deps);
    expect(deps.execInstall).toHaveBeenCalled();
  });

  it("does not install on --dry-run", async () => {
    const deps = makeUpgradeDeps();
    await runUpgrade({ dryRun: true }, deps);
    expect(deps.execInstall).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("omnibase-mcp upgrade"));
  });

  it("installs specific version with --version", async () => {
    const deps = makeUpgradeDeps();
    await runUpgrade({ version: "0.1.22" }, deps);
    expect(deps.execInstall).toHaveBeenCalledWith("npm install -g omnibase-mcp@0.1.22");
  });

  it("blocks major downgrade without --allow-major", async () => {
    const deps = makeUpgradeDeps({ currentVersion: "1.0.0" });
    await runUpgrade({ version: "0.1.23" }, deps);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("major version change"));
    expect(deps.execInstall).not.toHaveBeenCalled();
  });

  it("shows error when version not found", async () => {
    const deps = makeUpgradeDeps({ fetchVersionExists: vi.fn().mockResolvedValue(false) });
    await runUpgrade({ version: "0.1.99" }, deps);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(deps.execInstall).not.toHaveBeenCalled();
  });

  it("shows instructions for npx users instead of installing", async () => {
    const deps = makeUpgradeDeps({
      detectInstall: vi.fn().mockReturnValue({
        type: "npx" as const,
        message: "You're running via npx",
      }),
    });
    await runUpgrade({}, deps);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("npx"));
    expect(deps.execInstall).not.toHaveBeenCalled();
  });

  it("shows instructions for local installs instead of installing", async () => {
    const deps = makeUpgradeDeps({
      detectInstall: vi.fn().mockReturnValue({
        type: "local" as const,
        message: "Update the version in your package.json",
      }),
    });
    await runUpgrade({}, deps);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("package.json"));
    expect(deps.execInstall).not.toHaveBeenCalled();
  });

  it("shows network error when registry is unreachable", async () => {
    const deps = makeUpgradeDeps({
      fetchLatestVersion: vi.fn().mockRejectedValue(new Error("ENOTFOUND")),
    });
    await runUpgrade({}, deps);
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("Could not reach the npm registry"),
    );
    expect(deps.execInstall).not.toHaveBeenCalled();
  });
});
