import { describe, it, expect, beforeEach } from "vitest";
import { resolveSidecarPath } from "../../src/cli/sidecar-utils.js";

describe("resolveSidecarPath", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns OMNIBASE_SIDECAR_PATH env var when set", () => {
    process.env.OMNIBASE_SIDECAR_PATH = "/custom/path/sidecar";
    expect(resolveSidecarPath()).toBe("/custom/path/sidecar");
  });

  it("returns a path ending in omnibase-sidecar when env var is not set", () => {
    delete process.env.OMNIBASE_SIDECAR_PATH;
    expect(resolveSidecarPath()).toMatch(/omnibase-sidecar$/);
  });
});
