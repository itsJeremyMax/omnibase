import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { writeFileSync, mkdirSync, unlinkSync, existsSync, rmSync } from "fs";
import { createHash } from "crypto";
import os from "os";
import { _testing } from "../../src/cli/drivers";

const { verifyDriverChecksum, findPackageJson, getPackageRoot, getPlatformKey } = _testing;

describe("drivers CLI helpers", () => {
  describe("verifyDriverChecksum", () => {
    const tmpDir = join(os.tmpdir(), `drivers-test-${Date.now()}`);
    const tmpFile = join(tmpDir, "driver-test-darwin-arm64");

    beforeAll(() => {
      mkdirSync(tmpDir, { recursive: true });
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    afterEach(() => {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    });

    it("returns true when checksum matches", () => {
      const content = "test driver binary content";
      writeFileSync(tmpFile, content);
      const hash = createHash("sha256").update(Buffer.from(content)).digest("hex");
      const checksumsText = `${hash}  driver-test-darwin-arm64\notherhash  driver-other-linux-amd64\n`;

      expect(verifyDriverChecksum(tmpFile, "driver-test-darwin-arm64", checksumsText)).toBe(true);
    });

    it("returns false when checksum does not match", () => {
      writeFileSync(tmpFile, "actual content");
      const checksumsText =
        "0000000000000000000000000000000000000000000000000000000000000000  driver-test-darwin-arm64\n";

      expect(verifyDriverChecksum(tmpFile, "driver-test-darwin-arm64", checksumsText)).toBe(false);
    });

    it("returns false when asset is not in checksums file", () => {
      writeFileSync(tmpFile, "some content");
      const checksumsText = "abc123  driver-other-linux-amd64\n";

      expect(verifyDriverChecksum(tmpFile, "driver-test-darwin-arm64", checksumsText)).toBe(false);
    });

    it("does not match partial asset names", () => {
      writeFileSync(tmpFile, "some content");
      const hash = createHash("sha256").update(Buffer.from("some content")).digest("hex");
      // The checksums file has a .tar.gz suffix but we're looking for the bare name
      const checksumsText = `${hash}  driver-test-darwin-arm64.tar.gz\n`;

      expect(verifyDriverChecksum(tmpFile, "driver-test-darwin-arm64", checksumsText)).toBe(false);
    });

    it("handles multi-line checksums with correct matching", () => {
      const content = "binary data";
      writeFileSync(tmpFile, content);
      const hash = createHash("sha256").update(Buffer.from(content)).digest("hex");
      const checksumsText = [
        "aaaa  driver-postgres-linux-amd64",
        `${hash}  driver-test-darwin-arm64`,
        "bbbb  driver-mysql-linux-amd64",
      ].join("\n");

      expect(verifyDriverChecksum(tmpFile, "driver-test-darwin-arm64", checksumsText)).toBe(true);
    });
  });

  describe("findPackageJson", () => {
    it("finds the omnibase-mcp package.json", () => {
      const result = findPackageJson();
      expect(result).toContain("package.json");
      expect(existsSync(result)).toBe(true);

      const pkg = JSON.parse(require("fs").readFileSync(result, "utf-8"));
      expect(pkg.name).toBe("omnibase-mcp");
    });
  });

  describe("getPackageRoot", () => {
    it("returns the directory containing package.json", () => {
      const root = getPackageRoot();
      expect(existsSync(join(root, "package.json"))).toBe(true);
      expect(existsSync(join(root, "sidecar"))).toBe(true);
    });
  });

  describe("getPlatformKey", () => {
    it("returns a valid platform-arch string", () => {
      const key = getPlatformKey();
      expect(key).toMatch(/^(darwin|linux|windows)-(amd64|arm64)$/);
    });
  });
});

import { beforeAll, afterAll } from "vitest";
