import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text-summary", "json-summary"],
      // Ratchet: ~1-2 points under the coverage measured when the thresholds were set
      // (global: statements 81.1, branches 70.3, functions 82.4, lines 82.9; src/domain:
      // 96.0 / 85.8 / 96.9 / 98.4). Raise them as coverage grows; never lower them to land a change.
      thresholds: {
        statements: 79,
        branches: 68,
        functions: 81,
        lines: 81,
        "src/domain/**": {
          statements: 94,
          branches: 84,
          functions: 95,
          lines: 97,
        },
      },
    },
  },
});
