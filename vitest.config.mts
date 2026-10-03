import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["apps/**/*.{test,spec}.ts", "packages/**/*.{test,spec}.ts"],
    exclude: [
      ...configDefaults.exclude,
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.expo/**",
      "**/build/**",
      "**/out/**",
      "**/coverage/**",
      "**/.vitest/**",
      "**/generated/**",
    ],
  },
});
