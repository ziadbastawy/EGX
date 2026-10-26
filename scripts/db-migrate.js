import { runMigrations } from "../src/lib/db/migrate.js";
import { closePool, isDbConfigured } from "../src/lib/db/pool.js";

if (!isDbConfigured()) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

try {
  const result = await runMigrations();
  console.log("Migrations applied:", result.applied.length ? result.applied.join(", ") : "(none)");
  if (result.skipped.length) console.log("Already applied:", result.skipped.join(", "));
} finally {
  await closePool();
}
