// pg_dump/pg_restore plumbing for the in-app Backup & Restore screen
// (More → Backup & Restore). Deliberately mirrors scripts/backup/backup.sh
// and restore.sh (same flags, same filename shape) so UI downloads and the
// scheduled job's dumps are interchangeable either direction.
//
// Not `server-only`: callable from standalone tsx verification scripts,
// same convention as the queries/* modules.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// pg_restore emits one stderr line per dropped/recreated object; a real
// database's worth must not trip execFile's 1 MB default and kill an
// otherwise-successful run.
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

// Same shape backup.sh produces: monthly_budget_20260724T030509Z.dump
export function dumpFilename(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `monthly_budget_${stamp}.dump`;
}

// pg_dump custom-format archives start with the literal bytes "PGDMP".
export function isPgCustomDump(data: Uint8Array): boolean {
  const magic = [0x50, 0x47, 0x44, 0x4d, 0x50]; // "PGDMP"
  return data.length >= magic.length && magic.every((byte, i) => data[i] === byte);
}

async function runCommand(command: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(command, args, { maxBuffer: MAX_OUTPUT_BYTES });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      throw new Error(
        `${command} isn't available in this install — it was added to the app image alongside this screen, so an image built before it won't have it. Rebuild/update the app first.`,
      );
    }
    const stderr = (err.stderr ?? "").trim().split("\n").slice(-5).join("\n");
    throw new Error(`${command} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

export async function createDump(): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), "budget-backup-"));
  const out = path.join(dir, "dump");
  try {
    await runCommand("pg_dump", [
      "-Fc",
      "--no-owner",
      "--no-privileges",
      "-f",
      out,
      "--dbname",
      databaseUrl(),
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Destructive: replaces all current data with the dump's contents, then
// re-runs Drizzle migrations exactly like every container start does, so a
// dump from an older schema version catches up automatically. Callers are
// responsible for confirmation UX.
export async function restoreDump(data: Uint8Array): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "budget-restore-"));
  const dumpPath = path.join(dir, "dump");
  try {
    await writeFile(dumpPath, data);
    await runCommand("pg_restore", [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      databaseUrl(),
      dumpPath,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  await runCommand("node_modules/.bin/tsx", ["src/server/db/migrate.ts"]);
}
