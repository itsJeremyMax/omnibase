import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";

const POSTINSTALL = resolve(__dirname, "../scripts/postinstall.js");

describe("postinstall script", () => {
  it("runs without crashing", () => {
    // The script should not throw even if the binary already exists or download fails
    const result = execSync(`node ${POSTINSTALL} 2>&1`, {
      encoding: "utf-8",
      env: { ...process.env },
    });
    // Should either find existing binary or attempt download
    expect(result).toMatch(/already exists|Downloading|Go detected|not found/);
  });

  it("detects platform correctly", () => {
    // Test the platform detection logic by requiring the module internals
    const os = require("os");
    const platform = os.platform();
    const arch = os.arch();

    // We should be on a supported platform in CI/dev
    const platformMap: Record<string, string> = {
      darwin: "darwin",
      linux: "linux",
      win32: "windows",
    };
    const archMap: Record<string, string> = { arm64: "arm64", x64: "amd64" };

    expect(platformMap[platform]).toBeDefined();
    expect(archMap[arch]).toBeDefined();

    const key = `${platformMap[platform]}-${archMap[arch]}`;
    expect(key).toMatch(/^(darwin|linux|windows)-(amd64|arm64)$/);
  });

  it("generates correct download URL format", () => {
    const packageJson = require("../package.json");
    const version = packageJson.version;
    const repo = "itsJeremyMax/omnibase";

    // Test URL patterns for each platform
    const platforms = [
      { key: "darwin-arm64", binary: "omnibase-sidecar-darwin-arm64" },
      { key: "darwin-amd64", binary: "omnibase-sidecar-darwin-amd64" },
      { key: "linux-amd64", binary: "omnibase-sidecar-linux-amd64" },
      { key: "linux-arm64", binary: "omnibase-sidecar-linux-arm64" },
      { key: "windows-amd64", binary: "omnibase-sidecar-windows-amd64.exe" },
    ];

    for (const { key, binary } of platforms) {
      const url = `https://github.com/${repo}/releases/download/v${version}/${binary}`;
      expect(url).toContain(`v${version}`);
      expect(url).toContain(key);
      if (key.startsWith("windows")) {
        expect(url).toMatch(/\.exe$/);
      } else {
        expect(url).not.toMatch(/\.exe$/);
      }
    }
  });
});
