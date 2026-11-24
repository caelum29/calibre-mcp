// Oxlint config: the @cloudflare/oxlint-config preset (type-aware via tsrs) plus project guard rails —
// stdout ban, model-supplied regex, single spawn home, widget JS quirks.
import cloudflare from "@cloudflare/oxlint-config";
import { defineConfig } from "oxlint";

const spawnMessage =
  "Spawn subprocesses via src/calibre/spawn.ts: it bounds the timeout and kills the whole process group (#13, #145, #219).";

export default defineConfig({
  extends: [cloudflare],
  env: cloudflare.env,
  ignorePatterns: [
    ...cloudflare.ignorePatterns,
    "dist/**",
    "dist-mcpb/**",
    "build/**",
    "coverage/**",
    "test/eval/retrieval/reports/**",
    "src/ui/generated/**",
    "src/semantic/language/snowball/base-stemmer.ts",
    "src/semantic/language/snowball/ukrainian-stemmer.ts",
  ],
  rules: {
    complexity: ["warn", 20],
    "max-depth": ["warn", 4],
    "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
    "max-params": ["warn", 4],
  },
  overrides: [
    {
      files: ["test/**/*.ts", "scripts/**/*.mjs", "vitest.config.ts"],
      rules: { "no-console": "off", "max-lines": "off" },
    },
    {
      files: ["src/tools/**/*.ts", "src/app/**/*.ts"],
      rules: {
        "no-restricted-globals": [
          "error",
          {
            name: "RegExp",
            message:
              "Tool args are model-supplied: compile regex via compileUserRegex() in src/tools/user-regex.ts (PCRE inline flags, actionable errors, #30). Use a regex literal for static patterns.",
          },
        ],
      },
    },
    { files: ["src/tools/user-regex.ts"], rules: { "no-restricted-globals": "off" } },
    {
      files: ["src/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              { name: "node:child_process", message: spawnMessage },
              { name: "child_process", message: spawnMessage },
            ],
          },
        ],
      },
    },
    { files: ["src/calibre/spawn.ts"], rules: { "no-restricted-imports": "off" } },
    // Widget JS (#271): browser globals. Catch params and escapes stay as-is: the move is
    // byte-equivalent (test/ui/widget-snapshot.test.ts), cleanups are a separate change. Escapes are
    // off, not warn: lint-staged runs `oxlint --fix`, which would rewrite them on commit.
    {
      files: ["src/ui/**/*.js"],
      env: { browser: true },
      rules: {
        "no-unused-vars": ["error", { caughtErrors: "none" }],
        "no-useless-escape": "off",
      },
    },
    // Board JS files and shared/ fragments are pieces of one IIFE (board.html, card, figures), so
    // functions are used across files.
    { files: ["src/ui/board/*.js", "src/ui/shared/*.js"], rules: { "no-unused-vars": "off" } },
    // These carry the bare __DEBUG__ placeholder line that the *-html.ts render replaces.
    {
      files: ["src/ui/board/core.js", "src/ui/card/card.js", "src/ui/figures/figures.js"],
      rules: { "no-unused-expressions": "off" },
    },
    // MIGRATION BASELINE (temporary): preset rules that fail today, with their finding counts.
    // Each one is either enabled with fixes or kept off with a reason, one commit per rule.
    // Last override, so it also beats preset overrides that re-enable a rule (tests, *.ts).
    {
      files: ["**/*"],
      rules: {
        "typescript/array-type": "off", // 1954
        curly: "off", // 1934
        "typescript/no-unsafe-type-assertion": "off", // 1266
        "import/consistent-type-specifier-style": "off", // 458
        "typescript/no-non-null-assertion": "off", // 333
        "quality/no-chained-type-assertions": "off", // 276
        "no-var": "off", // 268
        "unicorn/consistent-function-scoping": "off", // 234
        "quality/no-conditional-empty-object-spread": "off", // 223
        "quality/no-unsafe-dictionary-type": "off", // 206
        "unicorn/catch-error-name": "off", // 131
        "no-undef": "off", // 127
        "unicorn/prefer-string-replace-all": "off", // 117
        "quality/no-known-value-widening": "off", // 111
        "unicorn/prefer-dom-node-append": "off", // 110
        "prefer-arrow-callback": "off", // 109
        "unicorn/numeric-separators-style": "off", // 108
        "typescript/no-unnecessary-type-assertion": "off", // 104
        "quality/no-array-filter-map": "off", // 59
        "unicorn/prefer-single-call": "off", // 56
        "unicorn/prefer-string-raw": "off", // 46
        "no-promise-executor-return": "off", // 42
        "unicorn/prefer-import-meta-properties": "off", // 26
        "typescript/require-array-sort-compare": "off", // 23
        "quality/no-unknown-returns": "off", // 23
        "unicorn/prefer-at": "off", // 20
        "typescript/consistent-type-imports": "off", // 19
        "object-shorthand": "off", // 14
        "unicorn/no-useless-promise-resolve-reject": "off", // 13
        "unicorn/prefer-structured-clone": "off", // 11
        "typescript/use-unknown-in-catch-callback-variable": "off", // 10
        "unicorn/prefer-set-has": "off", // 7
        "typescript/no-unsafe-return": "off", // 7
        eqeqeq: "off", // 7
        "unicorn/prefer-optional-catch-binding": "off", // 5
        "typescript/no-unsafe-assignment": "off", // 5
        "typescript/no-floating-promises": "off", // 5
        "quality/no-reflect-get": "off", // 5
        "preserve-caught-error": "off", // 5
        "unicorn/text-encoding-identifier-case": "off", // 4
        "unicorn/prefer-top-level-await": "off", // 4
        "typescript/no-unsafe-call": "off", // 4
        "quality/no-object-parameters": "off", // 4
        "unicorn/prefer-number-properties": "off", // 3
        "typescript/no-misused-spread": "off", // 3
        "unicorn/no-hex-escape": "off", // 2
        "unicorn/prefer-native-coercion-functions": "off", // 1
        "typescript/unbound-method": "off", // 1
        "typescript/return-await": "off", // 1
        "typescript/no-unsafe-member-access": "off", // 1
        "typescript/no-unsafe-argument": "off", // 1
        "import/no-namespace": "off", // 1
        "@nkzw/no-instanceof": "off", // 1
      },
    },
  ],
});
