// Flat ESLint config. Besides style, this file ENFORCES the hard architectural rules:
//   1. named exports only
//   2. no cross-module repository imports (service → service only)
//   3. only *.repository.sqlite.ts may touch the database
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/generated/**", "**/*.config.*"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportDefaultDeclaration",
          message: "Named exports only — default exports are not allowed (see CLAUDE.md)."
        }
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error"
    }
  },
  {
    files: ["apps/api/src/modules/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*/*.repository", "../*/*.repository.js", "**/modules/*/*.repository*"],
              message: "Cross-module repository import is forbidden. Call the other module's service instead."
            },
            {
              group: ["**/platform/sqlite*", "better-sqlite3"],
              message: "Only *.repository.sqlite.ts files may touch the database."
            }
          ]
        }
      ]
    }
  },
  {
    // SQLite repositories are the single place allowed to touch the database.
    files: ["apps/api/src/modules/**/*.repository.sqlite.ts", "apps/api/src/modules/**/*.repository.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*/*.repository", "../*/*.repository.js"],
              message: "Cross-module repository import is forbidden. Call the other module's service instead."
            }
          ]
        }
      ]
    }
  },
  {
    // Tooling entry files that legitimately need a default export live in *.config.* (ignored above).
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" }
  }
);
