import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Юнит-тесты кода сайта: src/**/*.test.ts. Браузерные сценарии — в e2e/ (Playwright).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
