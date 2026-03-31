import { describe, it, expect, vi } from "vitest";
import { parseVersion, compareVersions, isMajorChange } from "../src/update-checker.js";
import { checkForUpdate, getUpdateNotice } from "../src/update-checker.js";
import type { UpdateCheckDeps } from "../src/update-checker.js";

function makeDeps(overrides?: Partial<UpdateCheckDeps>): UpdateCheckDeps {
  return {
    fetchLatestVersion: vi.fn().mockResolvedValue("0.2.0"),
    readCache: vi.fn().mockReturnValue(null),
    writeCache: vi.fn(),
    now: () => 1711900000000,
    ...overrides,
  };
}

describe("parseVersion", () => {
  it("parses a standard semver string", () => {
    expect(parseVersion("0.1.23")).toEqual({ major: 0, minor: 1, patch: 23 });
  });

  it("parses a major-only version", () => {
    expect(parseVersion("2.0.0")).toEqual({ major: 2, minor: 0, patch: 0 });
  });
});

describe("compareVersions", () => {
  it("returns 1 when a is newer", () => {
    expect(compareVersions("0.1.23", "0.1.22")).toBe(1);
  });

  it("returns -1 when a is older", () => {
    expect(compareVersions("0.1.22", "0.1.23")).toBe(-1);
  });

  it("returns 0 when equal", () => {
    expect(compareVersions("0.1.23", "0.1.23")).toBe(0);
  });

  it("compares major before minor", () => {
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  });

  it("compares minor before patch", () => {
    expect(compareVersions("0.2.0", "0.1.99")).toBe(1);
  });
});

describe("isMajorChange", () => {
  it("detects major upgrade", () => {
    expect(isMajorChange("0.1.23", "1.0.0")).toBe(true);
  });

  it("detects major downgrade", () => {
    expect(isMajorChange("1.0.0", "0.1.23")).toBe(true);
  });

  it("returns false for minor upgrade", () => {
    expect(isMajorChange("0.1.23", "0.2.0")).toBe(false);
  });

  it("returns false for patch upgrade", () => {
    expect(isMajorChange("0.1.22", "0.1.23")).toBe(false);
  });

  it("returns false for same version", () => {
    expect(isMajorChange("0.1.23", "0.1.23")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  it("fetches from registry when cache is empty", async () => {
    const deps = makeDeps();
    const result = await checkForUpdate("0.1.23", deps);
    expect(deps.fetchLatestVersion).toHaveBeenCalled();
    expect(result).toEqual({ latestVersion: "0.2.0", checkedAt: 1711900000000 });
  });

  it("uses cache when fresh (under 24h)", async () => {
    const deps = makeDeps({
      readCache: vi.fn().mockReturnValue({
        latestVersion: "0.1.25",
        checkedAt: 1711900000000 - 3600000,
      }),
    });
    const result = await checkForUpdate("0.1.23", deps);
    expect(deps.fetchLatestVersion).not.toHaveBeenCalled();
    expect(result).toEqual({ latestVersion: "0.1.25", checkedAt: 1711900000000 - 3600000 });
  });

  it("re-fetches when cache is stale (over 24h)", async () => {
    const deps = makeDeps({
      readCache: vi.fn().mockReturnValue({
        latestVersion: "0.1.25",
        checkedAt: 1711900000000 - 90000000,
      }),
    });
    const result = await checkForUpdate("0.1.23", deps);
    expect(deps.fetchLatestVersion).toHaveBeenCalled();
    expect(result).toEqual({ latestVersion: "0.2.0", checkedAt: 1711900000000 });
  });

  it("writes cache after successful fetch", async () => {
    const deps = makeDeps();
    await checkForUpdate("0.1.23", deps);
    expect(deps.writeCache).toHaveBeenCalledWith({
      latestVersion: "0.2.0",
      checkedAt: 1711900000000,
    });
  });

  it("returns null when fetch fails", async () => {
    const deps = makeDeps({
      fetchLatestVersion: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const result = await checkForUpdate("0.1.23", deps);
    expect(result).toBeNull();
  });
});

describe("getUpdateNotice", () => {
  it("returns minor update notice when newer version available", async () => {
    const deps = makeDeps({ fetchLatestVersion: vi.fn().mockResolvedValue("0.1.25") });
    const notice = await getUpdateNotice("0.1.23", deps);
    expect(notice).toContain("0.1.23");
    expect(notice).toContain("0.1.25");
    expect(notice).toContain("omnibase-mcp upgrade");
  });

  it("returns major update notice with --allow-major", async () => {
    const deps = makeDeps({ fetchLatestVersion: vi.fn().mockResolvedValue("1.0.0") });
    const notice = await getUpdateNotice("0.1.23", deps);
    expect(notice).toContain("1.0.0");
    expect(notice).toContain("--allow-major");
  });

  it("returns null when already on latest", async () => {
    const deps = makeDeps({ fetchLatestVersion: vi.fn().mockResolvedValue("0.1.23") });
    const notice = await getUpdateNotice("0.1.23", deps);
    expect(notice).toBeNull();
  });

  it("returns null when NO_UPDATE_NOTIFIER is set", async () => {
    process.env.NO_UPDATE_NOTIFIER = "1";
    const deps = makeDeps();
    const notice = await getUpdateNotice("0.1.23", deps);
    expect(notice).toBeNull();
    delete process.env.NO_UPDATE_NOTIFIER;
  });

  it("returns null when fetch fails", async () => {
    const deps = makeDeps({
      fetchLatestVersion: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const notice = await getUpdateNotice("0.1.23", deps);
    expect(notice).toBeNull();
  });
});
