import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./src/db/auth-schema.ts",
    "./src/db/schema.ts",
    "./src/db/identity-schema.ts",
  ],
  out: "./drizzle/migrations",
  dialect: "sqlite",
});
