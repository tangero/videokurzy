import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";

const migrationsPath = path.resolve(__dirname, "drizzle/migrations");

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(migrationsPath);
      return {
        wrangler: {
          configPath: "./wrangler.toml",
          environment: "test",
        },
        miniflare: {
          compatibilityFlags: ["nodejs_compat"],
          bindings: {
            TEST_MIGRATIONS: migrations,
          },
        },
      };
    }),
  ],
  test: {
    exclude: [...configDefaults.exclude, "**/.claude/**"],
    setupFiles: ["./tests/setup-db.ts"],
  },
});
