import { defineConfig, globalIgnores } from "eslint/config";
import expo from "eslint-config-expo/flat.js";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  globalIgnores(["dist/**", ".expo/**", "build/**", "coverage/**"]),
  expo,
  prettier,
]);
