import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests-integration/**"],
    // postinstall tests temporarily replace/delete the sidecar binary on disk.
    // Running all test files in parallel causes sidecar spawn failures.
    fileParallelism: false,
  },
});
