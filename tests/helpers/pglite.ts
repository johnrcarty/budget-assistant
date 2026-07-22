import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "@/server/db/schema";

export type TestDb = PgliteDatabase<typeof schema>;

let testDb: TestDb | null = null;

// Fresh in-memory Postgres with the real migrations applied. One per test
// FILE (vitest's forks pool isolates files into processes; the module
// registry is per-file, so the vi.mock("@/server/db/client") factory that
// calls this runs exactly once per file). Per-TEST isolation comes from
// seeding a fresh household per test, not from resetting the database.
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema, casing: "snake_case" });
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../drizzle/migrations"),
  });
  testDb = db;
  return db;
}

// Typed access to the same instance the mocked "@/server/db/client" returns —
// avoids casting between PostgresJsDatabase (the real client's type) and
// PgliteDatabase in every test.
export function getTestDb(): TestDb {
  if (!testDb) {
    throw new Error(
      "Test DB not initialized - mock '@/server/db/client' with a factory that awaits createTestDb() first.",
    );
  }
  return testDb;
}
