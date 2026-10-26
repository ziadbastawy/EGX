import { createHash } from "node:crypto";

/** Phase 1.75 percent-point tolerance for vendor vs derived change %. */
export const VENDOR_CHANGE_PCT_TOLERANCE = 0.05;
export const VENDOR_CHANGE_ABS_TOLERANCE = 0.01;

export function sha256Hex(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

export function cairoWeekday(dateYmd) {
  if (!dateYmd) return null;
  const d = new Date(`${dateYmd}T12:00:00+02:00`);
  if (!Number.isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    weekday: "short",
  }).format(d);
}

/** EGX cash sessions: Sun–Thu. Holidays UNKNOWN. */
export function isEgxWeekday(dateYmd) {
  const wd = cairoWeekday(dateYmd);
  return wd === "Sun" || wd === "Mon" || wd === "Tue" || wd === "Wed" || wd === "Thu";
}

export function sessionDateFromMs(t, tzParseRule = "plus_02") {
  if (t == null || !Number.isFinite(Number(t))) return null;
  if (tzParseRule === "plus_02") {
    return new Date(Number(t)).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
  }
  return new Date(Number(t)).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

export function ohlcInvalid(bar) {
  const { open, high, low, close } = bar;
  const nums = [open, high, low, close].filter((x) => x != null && Number.isFinite(Number(x)));
  if (nums.length < 4) return false;
  const o = Number(open);
  const h = Number(high);
  const l = Number(low);
  const c = Number(close);
  return h < l || o > h || o < l || c > h || c < l;
}

export function negativePrice(bar) {
  for (const key of ["open", "high", "low", "close", "o", "h", "l", "c"]) {
    const v = bar[key];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n < 0) return true;
  }
  return false;
}

/** Negative volume only. Zero volume can be a valid session print. */
export function volumeInvalid(bar) {
  const v = bar.volume ?? bar.v;
  if (v == null || v === "") return false;
  const n = Number(v);
  if (!Number.isFinite(n)) return true;
  return n < 0;
}

export const CLOSE_JUMP_WARN_PCT = 0.25;

export function closeJumpPct(prevClose, close) {
  const a = Number(prevClose);
  const b = Number(close);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return (b - a) / Math.abs(a);
}

/**
 * Count EGX weekdays strictly between two YYYY-MM-DD dates (Cairo calendar).
 * Holidays are UNKNOWN, so large gaps are suspicious, not proven missing sessions.
 */
export function egxWeekdaysBetween(fromYmd, toYmd) {
  if (!fromYmd || !toYmd || fromYmd >= toYmd) return 0;
  let n = 0;
  const start = new Date(`${fromYmd}T12:00:00+02:00`);
  const end = new Date(`${toYmd}T12:00:00+02:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 0;
  const cur = new Date(start.getTime() + 86400000);
  while (cur < end) {
    const ymd = cur.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
    if (isEgxWeekday(ymd)) n += 1;
    cur.setTime(cur.getTime() + 86400000);
  }
  return n;
}

export function derivedChange(lastPrice, previousCloseVendor) {
  if (lastPrice == null || previousCloseVendor == null) {
    return { derivedChange: null, derivedChangePercentage: null };
  }
  const last = Number(lastPrice);
  const prev = Number(previousCloseVendor);
  if (!Number.isFinite(last) || !Number.isFinite(prev)) {
    return { derivedChange: null, derivedChangePercentage: null };
  }
  const ch = last - prev;
  const pct = prev !== 0 ? (ch / prev) * 100 : null;
  return { derivedChange: ch, derivedChangePercentage: pct };
}

export function changeFieldsTrusted(vendorChange, vendorPct, derivedCh, derivedPct) {
  if (derivedCh == null) return false;
  if (vendorChange == null && vendorPct == null) return false;
  let absOk = true;
  let pctOk = true;
  if (vendorChange != null && derivedCh != null) {
    absOk = Math.abs(Number(vendorChange) - Number(derivedCh)) <= VENDOR_CHANGE_ABS_TOLERANCE;
  }
  if (vendorPct != null && derivedPct != null) {
    pctOk = Math.abs(Number(vendorPct) - Number(derivedPct)) <= VENDOR_CHANGE_PCT_TOLERANCE;
  }
  if (vendorChange == null) absOk = true;
  if (vendorPct == null) pctOk = true;
  return absOk && pctOk;
}
