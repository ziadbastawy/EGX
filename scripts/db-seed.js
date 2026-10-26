import { seedUniverse } from "../src/persistence/seedUniverse.js";
import { closePool, isDbConfigured } from "../src/lib/db/pool.js";

if (!isDbConfigured()) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

try {
  const summary = await seedUniverse();
  console.log("Seed complete:", summary);
} finally {
  await closePool();
}
