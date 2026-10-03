import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier/flat";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex:
                "^(?!\\./|@smartretail/(domain|application)$|pg$)|(^|/)\\.\\.(/|$)",
              message:
                "Database may import only local source, domain/application public APIs and pg.",
            },
          ],
        },
      ],
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
];
