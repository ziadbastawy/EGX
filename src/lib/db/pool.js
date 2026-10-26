import pg from "pg";
import dotenv from "dotenv";
import path from "node:path";
import { ROOT } from "../../config.js";

dotenv.config({ path: path.join(ROOT, ".env") });

const { Pool } = pg;

let pool;

export function isDbConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
