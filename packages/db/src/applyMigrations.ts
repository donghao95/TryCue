import "./env.js";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to apply migrations.");
}

// Parse file: URL → absolute path
// file:./data/trycue.db → resolve relative to workspace root
const rawPath = databaseUrl.startsWith("file:")
  ? databaseUrl.slice("file:".length)
  : databaseUrl;

// Resolve relative paths against the Prisma schema directory (same as Prisma client)
const schemaDir = resolve(import.meta.dirname, "../prisma");
const normalizedPath = resolve(schemaDir, rawPath);

// Ensure parent directory exists
mkdirSync(dirname(normalizedPath), { recursive: true });

// Resolve migrations directory relative to this file (not CWD) so the script
// works regardless of the working directory it is invoked from.
const migrationsDir = resolve(import.meta.dirname, "../prisma/migrations");
const entries = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const db = new Database(normalizedPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

try {
  // Create _prisma_migrations tracking table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT PRIMARY KEY,
      "checksum" TEXT NOT NULL DEFAULT '',
      "finished_at" TEXT,
      "migration_name" TEXT NOT NULL UNIQUE,
      "logs" TEXT,
      "rolled_back_at" TEXT,
      "started_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);

  const hasBaseline = entries.includes("0001_baseline");
  if (hasBaseline) {
    const appliedMigrations = db
      .prepare(`SELECT "migration_name" FROM "_prisma_migrations" ORDER BY "migration_name"`)
      .all() as Array<{ migration_name: string }>;
    const appliedNames = appliedMigrations.map((row) => row.migration_name);

    const userTableCount = db
      .prepare(
        `SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name <> '_prisma_migrations'`
      )
      .get() as { count: number };

    const hasLegacyMigrations = appliedNames.some((name) => !entries.includes(name));
    const hasCorruptBaseline =
      appliedNames.includes("0001_baseline") &&
      !db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'audience_sampling_directives'`
        )
        .get();

    if (hasLegacyMigrations || (userTableCount.count > 0 && !appliedNames.includes("0001_baseline")) || hasCorruptBaseline) {
      // Destructive baseline reset is only allowed for local dev/test databases.
      // This script is intended for local dev/test only; production must use
      // `prisma migrate deploy`, which never drops tables. Fail-closed: block
      // both explicit production envs and unknown databases (the root db:*
      // scripts don't set NODE_ENV, so we also gate on DATABASE_URL matching
      // the project's dev/test naming convention, mirroring the test helper
      // in apps/api/src/tests/helpers.ts).
      const nodeEnv = process.env.NODE_ENV;
      const isKnownDevOrTestDb = databaseUrl.includes("trycue");
      if (nodeEnv === "production" || !isKnownDevOrTestDb) {
        throw new Error(
          "Refusing to drop tables outside local dev/test. Use `prisma migrate deploy` in production."
        );
      }
      console.warn("Resetting local development database schema for destructive 0001_baseline migration.");
      // Drop all user tables
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'`)
        .all() as Array<{ name: string }>;
      for (const { name } of tables) {
        db.exec(`DROP TABLE IF EXISTS "${name}"`);
      }
      // Clear migration records
      db.exec(`DELETE FROM "_prisma_migrations"`);
    }
  }

  const selectMigration = db.prepare(
    `SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = ?`
  );
  const insertMigration = db.prepare(
    `INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count")
     VALUES (?, ?, ?, datetime('now'), 1)`
  );

  for (const name of entries) {
    const applied = selectMigration.get(name);
    if (applied) {
      console.log(`Migration already applied: ${name}`);
      continue;
    }
    const sqlBuffer = readFileSync(join(migrationsDir, name, "migration.sql"));
    // Compute SHA256 checksum over the raw file bytes for parity with Prisma's
    // migration engine (which hashes raw bytes, not decoded strings). Strip BOM
    // only for execution, not for checksum, so BOM-bearing files stay compatible.
    const checksum = createHash("sha256").update(sqlBuffer).digest("hex");
    const sql = sqlBuffer.toString("utf8").replace(/^\uFEFF/, "");
    console.log(`Applying migration: ${name}`);
    // Use a UUID id instead of the manual_ prefix so the record is compatible
    // with Prisma's migration engine expectations.
    const migrationId = randomUUID();
    const applyTransaction = db.transaction(() => {
      db.exec(sql);
      insertMigration.run(migrationId, checksum, name);
    });
    try {
      applyTransaction();
    } catch (error) {
      console.error(`Failed to apply migration ${name}:`, error);
      throw error;
    }
  }
} finally {
  db.close();
}
