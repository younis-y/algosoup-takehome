import { defineConfig } from "vitest/config";

// Unit tests only; e2e/ is Playwright's.
export default defineConfig({ test: { include: ["lib/**/*.test.ts"] } });
