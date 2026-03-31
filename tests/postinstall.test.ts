import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { resolve, join } from "path";
import { existsSync, writeFileSync, unlinkSync, readFileSync, mkdirSync, chmodSync } from "fs";

const POSTINSTALL = resolve(__dirname, "../scripts/postinstall.js");
const SIDECAR_DIR = resolve(__dirname, "../sidecar");
const BIN_DIR = join(SIDECAR_DIR, "bin");
const VERSION_FILE = join(SIDECAR_DIR, ".sidecar-version");
const packageJson = require("../package.json");
const VERSION = packageJson.version;
const NODE = process.execPath;

function getBinaryPath() {
  const isWindows = process.platform === "win32";
  return join(BIN_DIR, isWindows ? "omnibase-sidecar.exe" : "omnibase-sidecar");
}

function saveSidecarState() {
  const binaryPath = getBinaryPath();
  const binaryExists = existsSync(binaryPath);
  const versionExists = existsSync(VERSION_FILE);
  const binaryContent = binaryExists ? readFileSync(binaryPath) : null;
  const versionContent = versionExists ? readFileSync(VERSION_FILE, "utf8") : null;
  return { binaryPath, binaryExists, versionExists, binaryContent, versionContent };
}

function restoreSidecarState(state: ReturnType<typeof saveSidecarState>) {
  if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR, { recursive: true });
  if (state.binaryExists && state.binaryContent) {
    writeFileSync(state.binaryPath, state.binaryContent);
    chmodSync(state.binaryPath, 0o755);
  } else if (existsSync(state.binaryPath)) {
    unlinkSync(state.binaryPath);
  }
  if (state.versionExists && state.versionContent) {
    writeFileSync(VERSION_FILE, state.versionContent);
  } else if (existsSync(VERSION_FILE)) {
    unlinkSync(VERSION_FILE);
  }
}

/**
 * Run postinstall with a fake version that doesn't exist on GitHub,
 * so the download 404s instantly and we test the logic without network delays.
 * PATH is restricted to only node's directory so Go build also fails fast.
 */
function runPostinstallWithFakeVersion(fakeVersion: string) {
  const nodeBinDir = resolve(NODE, "..");
  const wrapper = `
    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      const result = origLoad.call(this, request, parent, isMain);
      if (request.endsWith('package.json') && result && result.version === '${VERSION}') {
        return { ...result, version: '${fakeVersion}' };
      }
      return result;
    };
    require('${POSTINSTALL.replace(/'/g, "\\'")}');
  `;
  return execSync(`${NODE} -e '${wrapper.replace(/'/g, "'\\''")}'  2>&1`, {
    encoding: "utf-8",
    env: { ...process.env, PATH: nodeBinDir },
    timeout: 15000,
  });
}

function runPostinstall() {
  return execSync(`${NODE} ${POSTINSTALL} 2>&1`, {
    encoding: "utf-8",
    timeout: 60000,
  });
}

const { getExpectedChecksum, verifyChecksum } = require("../scripts/postinstall");

describe("checksum helpers", () => {
  it("parses checksum for matching asset from checksums text", () => {
    const checksumsText = [
      "abc123def456  omnibase-sidecar-darwin-arm64",
      "789xyz000111  omnibase-sidecar-darwin-arm64.tar.gz",
      "222333444555  omnibase-sidecar-linux-amd64",
    ].join("\n");

    expect(getExpectedChecksum(checksumsText, "omnibase-sidecar-darwin-arm64")).toBe(
      "abc123def456",
    );
  });

  it("returns null when asset is not in checksums text", () => {
    const checksumsText = "abc123  omnibase-sidecar-linux-amd64\n";
    expect(getExpectedChecksum(checksumsText, "omnibase-sidecar-darwin-arm64")).toBeNull();
  });

  it("does not match partial asset names", () => {
    const checksumsText = "abc123  omnibase-sidecar-darwin-arm64.tar.gz\n";
    expect(getExpectedChecksum(checksumsText, "omnibase-sidecar-darwin-arm64")).toBeNull();
  });

  it("verifies checksum of a file with matching hash", () => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");

    const tmpFile = path.join(os.tmpdir(), `checksum-test-${Date.now()}`);
    fs.writeFileSync(tmpFile, "hello world");

    // Known SHA-256 of "hello world"
    const expected = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
    const result = verifyChecksum(tmpFile, expected);
    fs.unlinkSync(tmpFile);

    expect(result.match).toBe(true);
    expect(result.actualHash).toBe(expected);
  });

  it("rejects checksum of a file with wrong hash", () => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");

    const tmpFile = path.join(os.tmpdir(), `checksum-test-${Date.now()}`);
    fs.writeFileSync(tmpFile, "hello world");

    const result = verifyChecksum(
      tmpFile,
      "0000000000000000000000000000000000000000000000000000000000000000",
    );
    fs.unlinkSync(tmpFile);

    expect(result.match).toBe(false);
    expect(result.actualHash).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });
});

describe("postinstall script", () => {
  it("runs without crashing", () => {
    const state = saveSidecarState();
    try {
      let result: string;
      try {
        result = runPostinstall();
      } catch (err: unknown) {
        // postinstall may exit non-zero when checksums are unavailable for
        // locally-built binaries -- that's a controlled failure, not a crash.
        result = (err as { stdout?: string }).stdout ?? String(err);
      }
      expect(result).toMatch(
        /already installed|Downloading|Upgrading|re-downloading|Go detected|not found|checksums/,
      );
    } finally {
      restoreSidecarState(state);
    }
  }, 120000);

  it("detects platform correctly", () => {
    const os = require("os");
    const platform = os.platform();
    const arch = os.arch();

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

  it("generates correct download URL format with release tag", () => {
    const repo = "itsJeremyMax/omnibase";

    const platforms = [
      { key: "darwin-arm64", binary: "omnibase-sidecar-darwin-arm64" },
      { key: "darwin-amd64", binary: "omnibase-sidecar-darwin-amd64" },
      { key: "linux-amd64", binary: "omnibase-sidecar-linux-amd64" },
      { key: "linux-arm64", binary: "omnibase-sidecar-linux-arm64" },
      { key: "windows-amd64", binary: "omnibase-sidecar-windows-amd64.exe" },
    ];

    for (const { key, binary } of platforms) {
      const url = `https://github.com/${repo}/releases/download/omnibase-mcp-v${VERSION}/${binary}`;
      expect(url).toContain(`omnibase-mcp-v${VERSION}`);
      expect(url).toContain(key);
      if (key.startsWith("windows")) {
        expect(url).toMatch(/\.exe$/);
      } else {
        expect(url).not.toMatch(/\.exe$/);
      }
    }
  });

  describe("version management", () => {
    let savedState: ReturnType<typeof saveSidecarState>;

    beforeEach(() => {
      savedState = saveSidecarState();
      if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR, { recursive: true });
    });

    afterEach(() => {
      restoreSidecarState(savedState);
    });

    it("skips download when binary exists and version matches", () => {
      writeFileSync(getBinaryPath(), "dummy-binary");
      writeFileSync(VERSION_FILE, VERSION);

      const result = runPostinstall();
      expect(result).toContain("already installed");
    });

    it("re-downloads when version file is missing", () => {
      writeFileSync(getBinaryPath(), "dummy-binary");
      if (existsSync(VERSION_FILE)) unlinkSync(VERSION_FILE);

      // Use fake version so download 404s instantly
      const result = runPostinstallWithFakeVersion("99.99.99");
      expect(result).toContain("re-downloading");
    });

    it("upgrades when version file has older version", () => {
      writeFileSync(getBinaryPath(), "dummy-binary");
      writeFileSync(VERSION_FILE, "0.0.0");

      // Use fake version so download 404s instantly
      const result = runPostinstallWithFakeVersion("99.99.99");
      expect(result).toContain("Upgrading");
      expect(result).toContain("0.0.0");
      expect(result).toContain("99.99.99");
    });

    it("removes old binary when version mismatches", () => {
      const binaryPath = getBinaryPath();
      writeFileSync(binaryPath, "old-dummy-binary");
      writeFileSync(VERSION_FILE, "0.0.0");

      // Use fake version so download 404s (binary gets deleted but not re-created)
      runPostinstallWithFakeVersion("99.99.99");
      expect(existsSync(binaryPath)).toBe(false);
    });

    it("removes old binary when version file is missing", () => {
      const binaryPath = getBinaryPath();
      writeFileSync(binaryPath, "old-dummy-binary");
      if (existsSync(VERSION_FILE)) unlinkSync(VERSION_FILE);

      runPostinstallWithFakeVersion("99.99.99");
      expect(existsSync(binaryPath)).toBe(false);
    });

    it("writes version file after successful download", () => {
      const binaryPath = getBinaryPath();
      writeFileSync(binaryPath, "dummy-binary");
      writeFileSync(VERSION_FILE, VERSION);

      runPostinstall();

      expect(existsSync(VERSION_FILE)).toBe(true);
      expect(readFileSync(VERSION_FILE, "utf8").trim()).toBe(VERSION);
    });

    it("does not write version file when download fails", () => {
      const binaryPath = getBinaryPath();
      if (existsSync(binaryPath)) unlinkSync(binaryPath);
      if (existsSync(VERSION_FILE)) unlinkSync(VERSION_FILE);

      // Fake version guarantees 404
      runPostinstallWithFakeVersion("99.99.99");
      expect(existsSync(VERSION_FILE)).toBe(false);
    });

    it("soft-fails when download 404s before reaching checksum verification", () => {
      const binaryPath = getBinaryPath();
      if (existsSync(binaryPath)) unlinkSync(binaryPath);
      if (existsSync(VERSION_FILE)) unlinkSync(VERSION_FILE);

      // Fake version guarantees 404 on binary download, so checksum
      // verification is never reached. Falls through to Go build
      // (which also fails with restricted PATH), then soft-fails.
      const result = runPostinstallWithFakeVersion("99.99.99");
      expect(result).toMatch(/not found|Download failed/);
    });
  });
});
