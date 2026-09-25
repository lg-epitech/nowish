import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.POSTGRES_URL_NON_POOLING ??
      process.env.POSTGRES_URL ??
      process.env.DATABASE_URL ??
      "postgresql://nowish:nowish@localhost:5433/nowish",
  },
  strict: true,
  verbose: true,
});
