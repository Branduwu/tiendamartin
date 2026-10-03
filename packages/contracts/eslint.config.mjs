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
              regex: "^(?!\\./|zod$)|(^|/)\\.\\.(/|$)",
              message:
                "Contracts source may only import Zod or local src modules.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "Use static permitted imports.",
        },
        {
          selector: "CallExpression[callee.name='require']",
          message: "Use static permitted imports.",
        },
      ],
    },
  },
];
