/** Thndr mutual-fund catalog (public names) + stance from EGX tape. Educational only. */

function median(nums) {
  const vals = nums.filter((n) => n != null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

function round(n, d = 1) {
  if (n == null || !Number.isFinite(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

/** Funds listed on Thndr support / explore (not a live scrape of the app). */
export const THNDR_FUNDS = [
  { code: "AZO", nameAr: "أزيموت فرص", nameEn: "AZ Opportunities", manager: "Azimut", kind: "equity", sharia: false },
  { code: "ASO", nameAr: "أزيموت فرص الشريعة", nameEn: "AZ Sharia Opportunities", manager: "Azimut", kind: "equity", sharia: true },
  { code: "AZN", nameAr: "أزيموت ناصر", nameEn: "Azimut Nasser", manager: "Azimut", kind: "equity", sharia: false },
  { code: "ALV", nameAr: "أزيموت LV", nameEn: "AZ LV Fund", manager: "Azimut", kind: "equity", sharia: false, sleeve: "lowvol" },
  { code: "AZS", nameAr: "أزيموت ادخار", nameEn: "AZ Savings", manager: "Azimut", kind: "savings", sharia: false },
  { code: "AZG", nameAr: "أزيموت ذهب", nameEn: "AZ Gold", manager: "Azimut", kind: "gold", sharia: false },
  { code: "CI30", nameAr: "سي آي EGX30 كابد", nameEn: "CI EGX30 Capped", manager: "CIAM", kind: "equity", sharia: false, sleeve: "large" },
  { code: "T70", nameAr: "ثاندر EGX70", nameEn: "Thndr EGX70", manager: "Thndr AM", kind: "equity", sharia: false, sleeve: "mid" },
  { code: "CGO", nameAr: "سي آي ذهب", nameEn: "CI Gold", manager: "CIAM", kind: "gold", sharia: true },
  { code: "CRE", nameAr: "سي آي عقارات", nameEn: "CI Real Estate", manager: "CIAM", kind: "sector", sector: "real_estate", sharia: false },
  { code: "CTI", nameAr: "سي آي اتصالات وتقنية", nameEn: "CI Telecoms & IT", manager: "CIAM", kind: "sector", sector: "telecom", sharia: false },
  { code: "CEX", nameAr: "سي آي مصدرين", nameEn: "CI Exporters", manager: "CIAM", kind: "sector", sectors: ["fertilizers", "industrials", "food", "energy"], sharia: false },
  { code: "CCB", nameAr: "سي آي استهلاكي", nameEn: "CI Consumer & Basic Needs", manager: "CIAM", kind: "sector", sectors: ["food", "pharma"], sharia: false },
  { code: "CFF", nameAr: "سي آي مالي وفنتك", nameEn: "CI Financial & Fintech", manager: "CIAM", kind: "sector", sectors: ["banks", "financials"], sharia: false },
  { code: "NMF", nameAr: "NM أسهم شريعة", nameEn: "NM Sharia Equity", manager: "Naeem", kind: "equity", sharia: true },
  { code: "CMS", nameAr: "مصر شريعة إكويتي", nameEn: "Misr Shariah Equity", manager: "Misr", kind: "equity", sharia: true },
  { code: "MTF", nameAr: "مصر تكافلي", nameEn: "Misr Takaful", manager: "Misr", kind: "savings", sharia: true },
  { code: "BSC", nameAr: "بي-سكيور", nameEn: "B-Secure", manager: "Beltone", kind: "savings", sharia: false },
  { code: "B70", nameAr: "بلتون بي-70", nameEn: "Beltone B-70", manager: "Beltone", kind: "equity", sharia: false, sleeve: "mid" },
  { code: "B35", nameAr: "بلتون بي-35", nameEn: "Beltone B-35", manager: "Beltone", kind: "equity", sharia: false, sleeve: "large" },
  { code: "BMM", nameAr: "بلتون مية مية", nameEn: "Beltone 100", manager: "Beltone", kind: "equity", sharia: false },
  { code: "BWA", nameAr: "بلتون وفرة", nameEn: "Beltone Wafra", manager: "Beltone", kind: "savings", sharia: false },
  { code: "BSB", nameAr: "بلتون سبائك", nameEn: "Beltone Bullion", manager: "Beltone", kind: "gold", sharia: false },
  { code: "CCM", nameAr: "كايرو كابيتال مومنتم", nameEn: "Cairo Capital Momentum", manager: "Cairo Capital", kind: "equity", sharia: false },
  { code: "NCS", nameAr: "سهمي 70 إن آي كابيتال", nameEn: "NI Capital EGX70", manager: "NI Capital", kind: "equity", sharia: false, sleeve: "mid" },
  { code: "PCM", nameAr: "PFI كاشي", nameEn: "PFI Cash", manager: "PFI", kind: "savings", sharia: false },
  { code: "BAL", nameAr: "بي ألفا", nameEn: "B Alpha", manager: "Beltone", kind: "equity", sharia: false },
  { code: "ATD", nameAr: "الأهلي تميز", nameEn: "Ahli Tamayoz", manager: "Ahli", kind: "equity", sharia: false },
  { code: "GRA", nameAr: "جرانيت", nameEn: "Granite", manager: "Granite", kind: "equity", sharia: false },
  { code: "BFF", nameAr: "بنك القاهرة الأول", nameEn: "Banque du Caire First", manager: "BDC", kind: "equity", sharia: false },
  { code: "AEF", nameAr: "الفنار", nameEn: "Al Fanar", manager: "Al Fanar", kind: "equity", sharia: false },
  { code: "AAF", nameAr: "آفاق", nameEn: "Afaq", manager: "Afaq", kind: "equity", sharia: false },
  { code: "AGO", nameAr: "جسور", nameEn: "Gosour", manager: "Gosour", kind: "equity", sharia: false },
  { code: "AIS", nameAr: "استثمار وأمان", nameEn: "Invest & Secure", manager: "AIS", kind: "balanced", sharia: false },
  { code: "NAM", nameAr: "NBK الميزان", nameEn: "NBK Al Meezan", manager: "NBK", kind: "equity", sharia: true },
  { code: "PGM", nameAr: "جي آي جي تأمين", nameEn: "GIG Insurance Fund", manager: "GIG", kind: "balanced", sharia: false },
  { code: "ADA", nameAr: "الأهلي دهب", nameEn: "Ahli Dahab", manager: "Ahli", kind: "gold", sharia: false },
  { code: "ADM", nameAr: "دياموند", nameEn: "Diamond Gold", manager: "Diamond", kind: "gold", sharia: false },
  { code: "ABR", nameAr: "بريق", nameEn: "Bareeq Gold", manager: "Bareeq", kind: "gold", sharia: false },
  { code: "CLOUDS", nameAr: "كلاودز الادخار", nameEn: "Thndr Clouds Savings", manager: "Thndr", kind: "savings", sharia: false, product: true },
];

function sleevePool(analyses, sleeve) {
  if (sleeve === "large") {
    return analyses.filter((a) => a.market?.liquidityTier === "high");
  }
  if (sleeve === "mid") {
    return analyses.filter((a) => a.market?.liquidityTier !== "high");
  }
  if (sleeve === "lowvol") {
    return analyses.filter((a) => (a.indicators?.atrPct || 0) > 0 && a.indicators.atrPct <= 2.8);
  }
  return analyses;
}

function sectorPool(analyses, fund) {
  const ids = fund.sectors || (fund.sector ? [fund.sector] : []);
  if (!ids.length) return analyses;
  const hit = analyses.filter((a) => ids.includes(a.company?.sectorId || a.considerations?.sector));
  return hit.length >= 6 ? hit : analyses;
}

export function buildFundTape(analyses) {
  const list = analyses || [];
  const chg = list.map((a) => a.changePercent);
  const mom = list.map((a) => a.indicators?.momentum5);
  const rsi = list.map((a) => a.indicators?.rsi);
  const up = list.filter((a) => (a.changePercent || 0) > 0).length;
  const trendUp = list.filter((a) => a.considerations?.trend === "up").length;
  const trendDown = list.filter((a) => a.considerations?.trend === "down").length;
  return {
    count: list.length,
    medianChg: median(chg),
    medianMom5: median(mom),
    medianRsi: median(rsi),
    breadth: list.length ? up / list.length : null,
    pctTrendUp: list.length ? trendUp / list.length : null,
    pctTrendDown: list.length ? trendDown / list.length : null,
  };
}

function equityScore(tape) {
  let s = 50;
  if (tape.medianChg != null) s += Math.max(-18, Math.min(18, tape.medianChg * 6));
  if (tape.breadth != null) s += (tape.breadth - 0.5) * 28;
  if (tape.medianMom5 != null) s += Math.max(-10, Math.min(10, tape.medianMom5 * 0.7));
  if (tape.pctTrendUp != null) s += (tape.pctTrendUp - 0.45) * 20;
  if (tape.medianRsi != null && tape.medianRsi > 68) s -= (tape.medianRsi - 68) * 1.4;
  if (tape.medianRsi != null && tape.medianRsi < 38) s += (38 - tape.medianRsi) * 0.6;
  if (tape.medianMom5 != null && tape.medianMom5 >= 8) s -= 12;
  if (tape.medianChg != null && tape.medianChg >= 2) s -= 8;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function stanceFromScore(score, { hot, weak } = {}) {
  if (hot) return "take_profit";
  if (weak) return score >= 48 ? "hold" : "take_profit";
  if (score >= 62) return "invest";
  if (score <= 38) return "take_profit";
  return "hold";
}

function invertForSavings(equityStance, equityScoreVal) {
  if (equityStance === "invest" && equityScoreVal >= 70) return { stance: "take_profit", score: 100 - equityScoreVal };
  if (equityStance === "invest") return { stance: "hold", score: 52 };
  if (equityStance === "take_profit") return { stance: "invest", score: Math.max(64, 100 - equityScoreVal) };
  return { stance: "invest", score: 60 };
}

function goldFromEquity(equityStance, tape) {
  const weak = (tape.medianChg || 0) <= -0.6 || (tape.breadth || 1) <= 0.4;
  const hot = (tape.medianRsi || 0) >= 70 || (tape.medianMom5 || 0) >= 8;
  if (weak || hot) return { stance: "invest", score: 68 };
  if (equityStance === "invest") return { stance: "hold", score: 50 };
  return { stance: "hold", score: 54 };
}

function reasonsFor(fund, stance, tape, langIsEn) {
  const chg = tape.medianChg != null ? `${tape.medianChg >= 0 ? "+" : ""}${round(tape.medianChg, 1)}%` : "—";
  const br = tape.breadth != null ? `${Math.round(tape.breadth * 100)}%` : "—";
  const ar = {
    invest: `شريط السوق يدعم الإضافة (${chg} وسيط الجلسة، اتساع ${br}).`,
    take_profit: `الشريط ممتد أو ضعيف — الأنسب تخفيف الوثائق (${chg}، اتساع ${br}).`,
    hold: `الشريط مختلط — الإبقاء على الوضع الحالي (${chg}، اتساع ${br}).`,
  };
  const en = {
    invest: `Tape supports adding (${chg} session median, breadth ${br}).`,
    take_profit: `Tape is stretched or weak — trim certificates (${chg}, breadth ${br}).`,
    hold: `Mixed tape — keep the current position (${chg}, breadth ${br}).`,
  };
  if (fund.kind === "savings") {
    ar.invest = `الأسهم مش في أفضل لحظة للزيادة — الادخار أنسب مكان للسيولة (${chg}).`;
    ar.take_profit = `الأسهم أوضح للزيادة — يمكن تدوير جزء من الادخار.`;
    ar.hold = `الادخار يظل مظلة سيولة؛ لا داعي لتغيير كبير.`;
    en.invest = `Equity tape is not a good add — savings is the better parking spot (${chg}).`;
    en.take_profit = `Equity looks like an add — rotating some savings is reasonable.`;
    en.hold = `Savings stays a liquidity sleeve; no big change.`;
  }
  if (fund.kind === "gold") {
    ar.invest = `الذهب كتحوّط: إما الأسهم ضعيفة أو ممتدة أكثر من اللازم.`;
    ar.take_profit = `الذهب أقل أولوية والشريط يدعم الأسهم.`;
    ar.hold = `الإبقاء على الذهب كتنويع، من غير زيادة أو تخفيف حاد.`;
    en.invest = `Gold as a hedge: equities are weak or stretched.`;
    en.take_profit = `Gold is lower priority while the equity tape supports adding.`;
    en.hold = `Keep gold as diversification without a sharp add or cut.`;
  }
  return langIsEn ? en[stance] : ar[stance];
}

/**
 * Attach invest | take_profit | hold using EGX universe tape (not live fund NAVs).
 */
export function scoreThndrFunds(analyses) {
  const all = analyses || [];
  const marketTape = buildFundTape(all);
  const eqScore = equityScore(marketTape);
  const hot =
    (marketTape.medianRsi || 0) >= 70 ||
    (marketTape.medianMom5 || 0) >= 8.5 ||
    (marketTape.medianChg || 0) >= 2.2;
  const weak = (marketTape.medianChg || 0) <= -0.9 || (marketTape.breadth || 1) <= 0.38;
  const equityStance = stanceFromScore(eqScore, { hot, weak });

  return THNDR_FUNDS.map((fund) => {
    let stance = equityStance;
    let score = eqScore;
    let tape = marketTape;

    if (fund.kind === "equity" || fund.kind === "sector") {
      const pool = fund.kind === "sector" ? sectorPool(all, fund) : sleevePool(all, fund.sleeve);
      tape = fund.kind === "sector" || fund.sleeve ? buildFundTape(pool) : marketTape;
      score = equityScore(tape);
      const localHot =
        (tape.medianRsi || 0) >= 70 || (tape.medianMom5 || 0) >= 8.5 || (tape.medianChg || 0) >= 2.2;
      const localWeak = (tape.medianChg || 0) <= -0.9 || (tape.breadth || 1) <= 0.38;
      stance = stanceFromScore(score, { hot: localHot, weak: localWeak });
    } else if (fund.kind === "savings") {
      const inv = invertForSavings(equityStance, eqScore);
      stance = inv.stance;
      score = Math.round(inv.score);
      tape = marketTape;
    } else if (fund.kind === "gold") {
      const g = goldFromEquity(equityStance, marketTape);
      stance = g.stance;
      score = g.score;
      tape = marketTape;
    } else if (fund.kind === "balanced") {
      const sav = invertForSavings(equityStance, eqScore);
      if (equityStance === sav.stance) stance = equityStance;
      else stance = "hold";
      score = Math.round((eqScore + sav.score) / 2);
      tape = marketTape;
    }

    return {
      ...fund,
      stance,
      score,
      tape: {
        medianChg: round(tape.medianChg, 2),
        breadth: tape.breadth != null ? round(tape.breadth * 100, 0) : null,
        medianRsi: round(tape.medianRsi, 0),
      },
      reasonAr: reasonsFor(fund, stance, tape, false),
      reasonEn: reasonsFor(fund, stance, tape, true),
    };
  });
}

export const SETTLEMENT_AR =
  "الشراء والبيع يعدّوا على جلسة واحدة بس: الطلب النهارده يتنفّذ في جلسة الشغل اللي بعدها، مش نفس اليوم.";
export const SETTLEMENT_EN =
  "Buys and sells skip one trading session: an order today executes on the next session, not the same day.";

export function fundsPhotoPrompt() {
  const catalog = THNDR_FUNDS.map((f) => `${f.code}|${f.nameAr}|${f.nameEn}`).join("; ");
  return `Read this Thndr Egypt funds screenshot.

Task: extract EVERY fund row that is visible — top to bottom, including gold, savings, Clouds, and small leftover amounts. Do not skip a row.

Each row: name + LARGE EGP = CURRENT VALUE (القيمة الحالية) + signed % like +2.95% or -1.20%.
Ignore unit NAV (~0.5–80 with many decimals), unit count, dates, and the big portfolio TOTAL at the top if it is not a fund name.

If a name is not in the catalog, STILL include it (name as written, code empty or best guess).
If % is missing, pnlPct = 0. If EGP is unreadable, still include the row with currentValue 0.
Do NOT treat 2.95 as 0.0295. Copy digits exactly.

Catalog (map when you can): ${catalog}

JSON only, one object per visible row:
{"holdings":[{"code":"AZO","name":"...","currentText":"15,250.75","pnlText":"+2.95%","currentValue":15250.75,"pnlPct":2.95}]}`;
}

const EASTERN_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function easternDigits(raw) {
  return String(raw ?? "")
    .replace(/[٠-٩]/g, (c) => String(EASTERN_DIGITS.indexOf(c)))
    .replace(/[۰-۹]/g, (c) => String(PERSIAN_DIGITS.indexOf(c)))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

export function parsePct(raw) {
  const s = easternDigits(raw)
    .trim()
    .replace(/%/g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.+-]/g, "");
  if (!s || s === "+" || s === "-" || s === ".") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** EGP: 15,250.75 | 15.250,75 | 15.000 | ١٥٬٢٥٠٫٧٥ — not a NAV like 12.3456 */
export function parseAmount(raw) {
  let s = easternDigits(raw).trim().replace(/[^\d.,+-]/g, "");
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const frac = s.length - lastComma - 1;
    s = frac === 3 || s.split(",").length > 2 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    const parts = s.split(".");
    if (parts.length > 2) {
      const last = parts.pop();
      s = last.length <= 2 ? `${parts.join("")}.${last}` : parts.concat(last).join("");
    } else if (parts[1].length === 3) {
      s = `${parts[0]}${parts[1]}`;
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Thndr list shows current EGP + P/L %. Store cost so UI value = cost * (1 + pct/100)
 * matches the screenshot.
 */
export function costFromCurrent(current, pnlPct) {
  const cur = Number(current);
  const pct = Number(pnlPct);
  if (!Number.isFinite(cur) || cur <= 0) return NaN;
  if (!Number.isFinite(pct) || pct === 0 || pct <= -99.9) return round2(cur);
  return round2(cur / (1 + pct / 100));
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "");
}

export function matchThndrFund(raw) {
  const code = String(raw?.code || raw?.ticker || "")
    .toUpperCase()
    .replace(/\.CA$/i, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();
  if (code) {
    const hit = THNDR_FUNDS.find((f) => f.code === code);
    if (hit) return hit;
  }
  const blob = norm(`${raw?.name || ""} ${raw?.nameAr || ""} ${raw?.nameEn || ""} ${raw?.code || ""}`);
  if (!blob) return null;
  let best = null;
  let bestLen = 0;
  for (const f of THNDR_FUNDS) {
    for (const label of [f.code, f.nameAr, f.nameEn]) {
      const n = norm(label);
      if (n.length >= 3 && blob.includes(n) && n.length > bestLen) {
        best = f;
        bestLen = n.length;
      }
    }
  }
  return best;
}

function fallbackCode(row, index) {
  const raw = String(row?.code || row?.ticker || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (raw.length >= 2) return raw.slice(0, 12);
  const n = norm(row?.name || row?.nameAr || row?.nameEn || "").slice(0, 10);
  if (n) return `X_${n}`.slice(0, 16);
  return `X${index + 1}`;
}

export function normalizeExtractedHoldings(rows) {
  const out = [];
  const seen = new Set();
  (rows || []).forEach((row, index) => {
    const fund = matchThndrFund(row);
    const code = fund?.code || fallbackCode(row, index);
    if (!code || seen.has(code)) return;
    const pnlPct = parsePct(row.pnlPct ?? row.pnlText ?? row.changePct ?? row.returnPct ?? row.pnl);
    const current = parseAmount(
      row.currentValue ?? row.currentText ?? row.current ?? row.value ?? row.egp
    );
    const invested = parseAmount(row.invested ?? row.cost);
    const rawAmount = parseAmount(row.amount ?? row.amountText);
    const pct = Number.isFinite(pnlPct) ? pnlPct : 0;
    let currentVal = NaN;
    if (Number.isFinite(current) && current > 0) currentVal = current;
    else if (Number.isFinite(rawAmount) && rawAmount > 0) currentVal = rawAmount;
    else if (Number.isFinite(invested) && invested > 0) {
      currentVal = pct !== 0 && pct > -99.9 ? invested * (1 + pct / 100) : invested;
    } else {
      currentVal = 0;
    }
    const name = String(row.name || row.nameAr || row.nameEn || fund?.nameAr || "").trim();
    if (currentVal <= 0 && !name && !fund) return;
    seen.add(code);
    out.push({
      code,
      name: fund ? fund.nameAr : name,
      amount: round2(currentVal),
      pnlPct: Number.isFinite(pnlPct) ? round2(pnlPct) : 0,
    });
  });
  return out;
}

function tokenizeMoney(text) {
  const src = easternDigits(text);
  const pcts = [];
  const amounts = [];
  const pctRe = /([+-]?\d{1,2}[.,]\d{1,2})\s*%/g;
  let m;
  while ((m = pctRe.exec(src))) {
    const n = parsePct(m[1]);
    if (Number.isFinite(n)) pcts.push({ n, i: m.index });
  }
  const amtRe = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{3,8}(?:[.,]\d{1,2})?/g;
  while ((m = amtRe.exec(src))) {
    if (/%/.test(src.slice(m.index, m.index + m[0].length + 2))) continue;
    const n = parseAmount(m[0]);
    if (!Number.isFinite(n) || n < 80) continue;
    if (n <= 80 && /\.\d{3,}$/.test(m[0].replace(",", "."))) continue;
    amounts.push({ n, i: m.index });
  }
  amounts.sort((a, b) => b.n - a.n);
  return {
    pct: pcts[0]?.n,
    amount: amounts[0]?.n,
  };
}

function fundFromLine(line) {
  const nline = norm(line);
  if (!nline) return null;
  let best = null;
  let bestLen = 0;
  for (const f of THNDR_FUNDS) {
    for (const label of [f.nameAr, f.nameEn]) {
      const n = norm(label);
      if (n.length < 5) continue;
      if (nline.includes(n) && n.length > bestLen) {
        best = f;
        bestLen = n.length;
      }
    }
    const codeRe = new RegExp(`(^|[^a-z0-9])${f.code}([^a-z0-9]|$)`, "i");
    if (codeRe.test(line) && f.code.length + 2 >= bestLen) {
      best = f;
      bestLen = f.code.length + 2;
    }
  }
  return best;
}

/** Best-effort parse of OCR / pasted Thndr fund list text. */
export function parseHoldingsFromText(text) {
  const raw = easternDigits(String(text || "").replace(/\u00a0/g, " "));
  if (!raw.trim()) return [];
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const blocks = [];
  for (const line of lines) {
    const fund = fundFromLine(line);
    if (fund) {
      blocks.push({ fund, lines: [line] });
    } else if (blocks.length) {
      const last = blocks[blocks.length - 1];
      if (last.lines.length < 8) last.lines.push(line);
    }
  }
  const seen = new Set();
  const rows = [];
  for (const block of blocks) {
    if (seen.has(block.fund.code)) continue;
    const chunk = block.lines.join("\n");
    const { amount, pct } = tokenizeMoney(chunk);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    seen.add(block.fund.code);
    const pnlPct = Number.isFinite(pct) ? pct : 0;
    rows.push({
      code: block.fund.code,
      amount: round2(amount),
      pnlPct: round2(pnlPct),
    });
  }
  return rows;
}

function money(current, pnlPct) {
  const value = Number(current) || 0;
  const p = Number(pnlPct) || 0;
  const amount = costFromCurrent(value, p);
  const cost = Number.isFinite(amount) ? amount : value;
  return { amount: cost, pnlPct: p, value, pnlAbs: value - cost };
}

function roundEgp(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 100) return Math.round(n);
  return Math.round(n / 50) * 50;
}

function holdingAction(tapeStance, pnlPct, kind) {
  if (tapeStance === "sell_all") return kind === "savings" ? "reduce" : pnlPct <= -8 ? "hold" : "sell_all";
  if (tapeStance === "invest") return "add";
  if (tapeStance === "take_profit") return pnlPct >= 2 ? "reduce" : "hold";
  return "hold";
}

export function adviseHolding(holding, scored) {
  const m = money(holding?.amount, holding?.pnlPct);
  const tapeStance = scored?.stance || "hold";
  const kind = scored?.kind || "equity";
  let action = holdingAction(tapeStance, m.pnlPct, kind);
  const reasons = [];

  if (kind !== "savings" && m.pnlPct >= 18) {
    action = tapeStance === "invest" ? "reduce" : "sell_all";
    reasons.push(`مكسب ${round(m.pnlPct, 2)}٪ — ${action === "sell_all" ? "بيع خالص" : "قلل"}`);
  } else if (m.pnlPct <= -12) {
    action = "hold";
    reasons.push("خسارة كبيرة — بلا تزويد وبلا بيع مذعور");
  } else {
    reasons.push(scored?.reasonAr || "");
  }

  let egp = 0;
  if (action === "add") egp = roundEgp(Math.max(500, m.value * 0.15));
  if (action === "reduce") egp = roundEgp(m.value * 0.3);
  if (action === "sell_all") egp = roundEgp(m.value);

  const lineAr =
    action === "add"
      ? `زود بحوالي ${egp.toLocaleString("en-EG")} جنيه`
      : action === "reduce"
        ? `قلل / استرد بحوالي ${egp.toLocaleString("en-EG")} جنيه`
        : action === "sell_all"
          ? `بيع خالص ≈ ${egp.toLocaleString("en-EG")} جنيه`
          : "استمرار — متزودش ومتبيعش دلوقتي";
  const lineEn =
    action === "add"
      ? `Add about ${egp.toLocaleString("en-EG")} EGP`
      : action === "reduce"
        ? `Reduce / redeem about ${egp.toLocaleString("en-EG")} EGP`
        : action === "sell_all"
          ? `Sell all ≈ ${egp.toLocaleString("en-EG")} EGP`
          : "Hold — don’t add or sell now";

  return { ...m, action, tapeStance, egp, lineAr, lineEn, reasons: reasons.filter(Boolean).slice(0, 3) };
}

export function outsideBuyIdeas(scored, heldCodes, { limit = 5 } = {}) {
  const held = heldCodes instanceof Set ? heldCodes : new Set(heldCodes || []);
  return (scored || [])
    .filter((f) => f.stance === "invest" && !held.has(f.code))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit)
    .map((f) => ({
      ...f,
      action: "add",
      lineAr: `اشتري من بره: ${f.nameAr} (${f.code}) — التنفيذ الجلسة الجاية مش النهارده`,
      lineEn: `Buy outside the list: ${f.nameEn} (${f.code}) — executes next session, not today`,
    }));
}

export function adviseMoves(rows) {
  const cuts = rows.filter((r) => r.local?.action === "reduce" || r.local?.action === "sell_all");
  const adds = rows.filter((r) => r.local?.action === "add");
  if (!cuts.length || !adds.length) return [];
  const from = cuts.sort((a, b) => (b.local?.value || 0) - (a.local?.value || 0))[0];
  const to = adds.sort((a, b) => (b.fund?.score || 0) - (a.fund?.score || 0))[0];
  if (!from || !to || from.holding.code === to.holding.code) return [];
  return [
    {
      from: from.holding.code,
      to: to.holding.code,
      fromNameAr: from.fund?.nameAr || from.holding.code,
      fromNameEn: from.fund?.nameEn || from.holding.code,
      toNameAr: to.fund?.nameAr || to.holding.code,
      toNameEn: to.fund?.nameEn || to.holding.code,
    },
  ];
}
