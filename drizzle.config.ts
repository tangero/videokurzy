import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./src/db/auth-schema.ts", "./src/db/schema.ts"],
  out: "./drizzle/migrations",
  dialect: "sqlite",
});
