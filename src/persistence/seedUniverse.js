import { DEFAULT_SYMBOLS } from "../../data/symbols.js";
import { mubasherCode } from "../lib/mubasher.js";
import { getPool } from "../lib/db/pool.js";
import { persistValidation } from "./persistValidation.js";
import { sha256Hex } from "./integrity.js";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../config.js";

const SEED_FROM = "1970-01-01";

async function insertMapping(client, { instrumentId, providerId, providerSymbol, role, notes, summary, collisions }) {
  const { rows } = await client.query(
    `INSERT INTO provider_symbol_mapping (
       instrument_id, provider_id, provider_symbol, role, valid_from,
       valid_to, verification_class, notes
     ) VALUES ($1, $2, $3, $4, $5, NULL, 'SEED_FROM_FILE', $6)
     ON CONFLICT (provider_id, provider_symbol, valid_from) DO NOTHING
     RETURNING id, instrument_id`,
    [instrumentId, providerId, providerSymbol, role, SEED_FROM, notes]
  );
  if (rows.length) {
    summary.mappings += 1;
    return;
  }
  const existing = await client.query(
    `SELECT instrument_id FROM provider_symbol_mapping
     WHERE provider_id = $1 AND provider_symbol = $2 AND valid_from = $3`,
    [providerId, providerSymbol, SEED_FROM]
  );
  const existingId = existing.rows[0]?.instrument_id;
  if (existingId && existingId !== instrumentId) {
    collisions.push({
      providerSymbol,
      instrumentIds: [existingId, instrumentId],
    });
  }
}

function yahooRoleAndNotes(symbol) {
  const ticker = symbol.ticker;
  const yahoo = symbol.yahoo;
  if (!yahoo || yahoo === ticker) {
    return { role: "fetch", notes: null, providerSymbol: ticker };
  }
  if (yahoo.startsWith("EGS") && yahoo.endsWith(".CA")) {
    return {
      role: "fetch",
      notes: "ISIN-style Yahoo override (fetch ticker ≠ display ticker)",
      providerSymbol: yahoo,
    };
  }
  return {
    role: "fetch_alias",
    notes: "Yahoo fetch alias, not an ISIN and not an identity merge",
    providerSymbol: yahoo,
  };
}

export async function seedUniverse({ symbols = DEFAULT_SYMBOLS } = {}) {
  const pool = getPool();
  const client = await pool.connect();
  const summary = {
    providers: 0,
    instruments: 0,
    mappings: 0,
    collisions: 0,
  };
  const collisions = [];

  try {
    await client.query("BEGIN");

    const providers = {};
    for (const code of ["mubasher", "yahoo"]) {
      const { rows } = await client.query(
        `INSERT INTO provider (code) VALUES ($1)
         ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
         RETURNING id, code`,
        [code]
      );
      providers[code] = rows[0];
      summary.providers += 1;
    }

    const yahooFetchToInstruments = new Map();

    for (const symbol of symbols) {
      const ticker = symbol.ticker;
      const { rows: instRows } = await client.query(
        `INSERT INTO instrument (display_ticker, name_ar, name_en, listing_status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (display_ticker) DO UPDATE
           SET name_ar = EXCLUDED.name_ar,
               name_en = EXCLUDED.name_en
         RETURNING id`,
        [ticker, symbol.nameAr ?? null, symbol.nameEn ?? null]
      );
      const instrumentId = instRows[0].id;
      summary.instruments += 1;

      const mubCode = mubasherCode(ticker);
      await insertMapping(client, {
        instrumentId,
        providerId: providers.mubasher.id,
        providerSymbol: mubCode,
        role: "fetch",
        notes: "mubasherCode strips .CA",
        summary,
        collisions,
      });

      const y = yahooRoleAndNotes(symbol);
      await insertMapping(client, {
        instrumentId,
        providerId: providers.yahoo.id,
        providerSymbol: y.providerSymbol,
        role: y.role,
        notes: y.notes,
        summary,
        collisions,
      });

      const key = `yahoo:${y.providerSymbol}`;
      if (!yahooFetchToInstruments.has(key)) yahooFetchToInstruments.set(key, []);
      yahooFetchToInstruments.get(key).push({ instrumentId, ticker });
    }

    await client.query("COMMIT");

    for (const [key, list] of yahooFetchToInstruments) {
      const uniqueIds = [...new Set(list.map((x) => x.instrumentId))];
      if (uniqueIds.length < 2) continue;
      collisions.push({
        providerSymbol: key,
        tickers: list.map((x) => x.ticker),
        instrumentIds: uniqueIds,
      });
    }

    for (const payload of collisions) {
      summary.collisions += 1;
      await persistValidation({
        checkCode: "mapping_collision",
        severity: "warn",
        passed: false,
        payload,
      });
    }

    try {
      const symbolsPath = path.join(ROOT, "data", "symbols.js");
      const body = await fs.readFile(symbolsPath, "utf8");
      summary.universeFileSha256 = sha256Hex(body);
    } catch {
      summary.universeFileSha256 = null;
    }

    return summary;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
