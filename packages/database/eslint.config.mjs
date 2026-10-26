import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier/flat";

const databaseImports = (nodeLoader = false) => [
  "error",
  {
    patterns: [
      {
        regex:
          "^(?!\\./|@smartretail/(domain|application)$|pg$" +
          (nodeLoader ? "|node:module$" : "") +
          ")|(^|/)\\.\\.(/|$)",
        message:
          "Database may import only local source, domain/application public APIs and pg; the pool entry may use Node's module loader.",
      },
    ],
  },
];

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": databaseImports(),
      "no-restricted-syntax": [
        "error",
        { selector: "ImportExpression", message: "Use static imports." },
        {
          selector: "CallExpression[callee.name='require']",
          message: "Use static imports.",
        },
      ],
    },
  },
  {
    files: ["src/index.ts"],
    rules: { "no-restricted-imports": databaseImports(true) },
  },
];
