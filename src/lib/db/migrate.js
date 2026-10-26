import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../../config.js";
import { getPool } from "./pool.js";

const MIGRATIONS_DIR = path.join(ROOT, "migrations");

export async function runMigrations() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (await pool.query("SELECT id FROM schema_migrations")).rows.map((r) => r.id)
  );

  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await client.query("COMMIT");
      ran.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return { applied: ran, skipped: files.filter((f) => applied.has(f)) };
}
