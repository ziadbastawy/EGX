/**
 * Isolated Phase 1.75 research script. NOT imported by production.
 * Fetches Mubasher quote JSON + historical CSV and writes integrity JSON.
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const SAMPLE = [
  "COMI", "ADIB", "SWDY", "FWRY", "EAST", "ORAS", "ABUK", "MFPC",
  "TMGH", "PHDC", "ETEL", "HRHO", "JUFO", "EFIH", "CIRA", "ORWE",
];

const TARGET_DATES = [
  "2026-08-20",
  "2026-05-20",
  "2025-08-20",
  "2024-08-20",
  "2023-08-20",
  "2021-08-20",
];

function parseNum(str) {
  if (str == null || str === "") return null;
  const m = String(str).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function parseCsv(text) {
  const candles = [];
  const skipped = { short: 0, badDate: 0, badOhlc: 0 };
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split(",");
    if (parts.length < 5) {
      skipped.short += 1;
      continue;
    }
    const datePart = parts[0].split("/")[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      skipped.badDate += 1;
      continue;
    }
    const t = Date.parse(`${datePart}T00:00:00+02:00`);
    const o = parseNum(parts[1]);
    const h = parseNum(parts[2]);
    const l = parseNum(parts[3]);
    const c = parseNum(parts[4]);
    const v = parts[5] != null ? parseNum(parts[5]) : null;
    if (!Number.isFinite(t) || [o, h, l, c].some((x) => x == null)) {
      skipped.badOhlc += 1;
      continue;
    }
    candles.push({ d: datePart, t, o, h, l, c, v });
  }
  return { candles, skipped };
}

function weekday(iso) {
  return new Date(`${iso}T12:00:00+02:00`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "Africa/Cairo",
  });
}

function findExact(candles, iso) {
  return candles.find((c) => c.d === iso) || null;
}

function integrity(candles) {
  const byDate = new Map();
  let dup = 0;
  for (const c of candles) {
    if (byDate.has(c.d)) dup += 1;
    else byDate.set(c.d, c);
  }
  const dates = [...byDate.keys()].sort();
  let invalidOhlc = 0;
  let zeroVol = 0;
  let zeroPx = 0;
  let negPx = 0;
  const issues = [];
  for (const c of byDate.values()) {
    if (c.h < c.l) {
      invalidOhlc += 1;
      issues.push({ type: "high_lt_low", d: c.d });
    }
    if (c.o > c.h + 1e-9 || c.o < c.l - 1e-9) {
      invalidOhlc += 1;
      issues.push({ type: "open_outside", d: c.d, o: c.o, h: c.h, l: c.l });
    }
    if (c.c > c.h + 1e-9 || c.c < c.l - 1e-9) {
      invalidOhlc += 1;
      issues.push({ type: "close_outside", d: c.d, c: c.c, h: c.h, l: c.l });
    }
    if (c.v === 0) zeroVol += 1;
    if (c.o === 0 || c.h === 0 || c.l === 0 || c.c === 0) zeroPx += 1;
    if ([c.o, c.h, c.l, c.c].some((x) => x < 0)) negPx += 1;
  }

  const jumps = [];
  for (let i = 1; i < dates.length; i++) {
    const a = byDate.get(dates[i - 1]);
    const b = byDate.get(dates[i]);
    if (!a.c) continue;
    const pct = ((b.c - a.c) / a.c) * 100;
    const gapDays = (b.t - a.t) / 86400000;
    if (Math.abs(pct) >= 25) {
      jumps.push({
        from: a.d,
        to: b.d,
        gapDays,
        prevC: a.c,
        nextC: b.c,
        pct: Math.round(pct * 100) / 100,
      });
    }
  }

  // Missing sessions: calendar Sun-Thu between first and last (approx EGX)
  let missingSunThu = 0;
  const missingSamples = [];
  if (dates.length >= 2) {
    const start = new Date(`${dates[0]}T12:00:00+02:00`);
    const end = new Date(`${dates.at(-1)}T12:00:00+02:00`);
    const set = new Set(dates);
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      const d = new Date(t);
      const iso = d.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
      const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "Africa/Cairo" });
      if (["Sat", "Fri"].includes(wd)) continue;
      if (!set.has(iso)) {
        missingSunThu += 1;
        if (missingSamples.length < 8) missingSamples.push({ d: iso, wd });
      }
    }
  }

  return {
    uniqueDates: dates.length,
    duplicateDates: dup,
    invalidOhlc,
    zeroVol,
    zeroPx,
    negPx,
    jumps25: jumps.length,
    jumps: jumps.slice(0, 15),
    missingSunThuApprox: missingSunThu,
    missingSamples,
    issueSample: issues.slice(0, 12),
  };
}

async function fetchQuote(code) {
  const res = await fetch(`https://www.mubasher.info/api/1/markets/EGX/stocks/${code}`, {
    headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": "ar,en" },
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function fetchCsv(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" } });
  const text = await res.text();
  return { status: res.status, text };
}

const out = { fetchedAt: new Date().toISOString(), symbols: {} };

for (const code of SAMPLE) {
  const q = await fetchQuote(code);
  const bar = q.json?.companyTab?.priceBar || {};
  const histUrl = q.json?.stocks?.[0]?.historicalFileUrl;
  const csv = histUrl ? await fetchCsv(histUrl) : { status: 0, text: "" };
  const { candles, skipped } = parseCsv(csv.text);
  const last = candles.at(-1);
  const prev = candles.at(-2);
  const live = {
    value: parseNum(bar.value),
    open: parseNum(bar.open),
    high: parseNum(bar.high),
    low: parseNum(bar.low),
    volume: parseNum(bar.volume),
    closePrev: parseNum(bar.close),
    change: parseNum(bar.change),
    changePercentage: parseNum(bar.changePercentage),
    updatedAt: bar.updatedAt || null,
  };
  const computedFromPrevClose =
    live.value != null && live.closePrev
      ? {
          change: live.value - live.closePrev,
          changePct: ((live.value - live.closePrev) / live.closePrev) * 100,
        }
      : null;
  const computedFromCsvPrev =
    live.value != null && prev
      ? {
          change: live.value - prev.c,
          changePct: ((live.value - prev.c) / prev.c) * 100,
        }
      : null;
  const computedCsvCloseVsPrev =
    last && prev
      ? {
          change: last.c - prev.c,
          changePct: ((last.c - prev.c) / prev.c) * 100,
        }
      : null;

  const targets = {};
  for (const d of TARGET_DATES) {
    const hit = findExact(candles, d);
    targets[d] = {
      requestedWeekday: weekday(d),
      exact: Boolean(hit),
      row: hit || null,
    };
  }

  out.symbols[code] = {
    httpQuote: q.status,
    httpCsv: csv.status,
    histUrlPresent: Boolean(histUrl),
    nRows: candles.length,
    first: candles[0] || null,
    last,
    prev,
    skipped,
    live,
    quoteVsCsv: last
      ? {
          dateMatch: live.updatedAt ? String(live.updatedAt).slice(0, 10) === last.d : null,
          liveDate: live.updatedAt ? String(live.updatedAt).slice(0, 10) : null,
          csvDate: last.d,
          open: { live: live.open, csv: last.o, eq: live.open === last.o },
          high: { live: live.high, csv: last.h, eq: live.high === last.h },
          low: { live: live.low, csv: last.l, eq: live.low === last.l },
          close: { live: live.value, csv: last.c, diff: live.value != null ? live.value - last.c : null },
          volume: { live: live.volume, csv: last.v, eq: live.volume === last.v },
        }
      : null,
    changeCheck: {
      bar: { change: live.change, changePercentage: live.changePercentage, prevCloseField: live.closePrev },
      vsPrevCloseField: computedFromPrevClose,
      vsCsvPrevClose: computedFromCsvPrev,
      csvLastVsCsvPrev: computedCsvCloseVsPrev,
    },
    targets,
    integrity: integrity(candles),
  };
  await new Promise((r) => setTimeout(r, 180));
}

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const dir = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(dir, "out"), { recursive: true });
writeFileSync(join(dir, "out/mubasher-integrity.json"), JSON.stringify(out, null, 2));
console.log("wrote", join(dir, "out/mubasher-integrity.json"));
