import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Local-date math (date-range, month helpers) must be deterministic
    // regardless of the machine's zone; pin a negative-UTC-offset zone so
    // any accidental toISOString() day-shift shows up as a failure.
    env: { TZ: "America/Chicago" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
