import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

function createDatabase() {
  const databaseUrl =
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL ??
    (process.env.NODE_ENV !== "production"
      ? "postgresql://nowish:nowish@localhost:5433/nowish"
      : undefined);

  if (!databaseUrl) {
    throw new Error(
      "POSTGRES_URL, POSTGRES_URL_NON_POOLING, or DATABASE_URL must be configured",
    );
  }

  const client = postgres(databaseUrl, {
    max: process.env.NODE_ENV === "production" ? 10 : 2,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDatabase>;

const globalForDatabase = globalThis as typeof globalThis & {
  nowishDatabase?: Database;
};

let database: Database | undefined;

export function getDb(): Database {
  if (database) return database;

  if (process.env.NODE_ENV !== "production" && globalForDatabase.nowishDatabase) {
    database = globalForDatabase.nowishDatabase;
    return database;
  }

  database = createDatabase();

  if (process.env.NODE_ENV !== "production") {
    globalForDatabase.nowishDatabase = database;
  }

  return database;
}

export { schema };
