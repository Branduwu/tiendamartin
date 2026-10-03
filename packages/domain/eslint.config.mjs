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
              regex: "^(?!\\./)|(^|/)\\.\\.(/|$)",
              message:
                "Domain source may only import local modules within src.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "ImportExpression", message: "Use static local imports." },
        {
          selector: "CallExpression[callee.name='require']",
          message: "Use static local imports.",
        },
      ],
    },
  },
];
