import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

async function main() {
  const migrationClient = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(migrationClient, { casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle/migrations" });
  await migrationClient.end();
  console.log("Migrations applied");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
