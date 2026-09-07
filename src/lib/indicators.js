/** Technical indicators + multi-factor EGX stock analysis (educational use only). */

import { buildCompanyProfile } from "./companyContext.js";
import { buildPriceDepth, summarizeDepth } from "./priceDepth.js";

function last(arr) {
  return arr.length ? arr[arr.length - 1] : null;
}

function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function macdSeries(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );

  const macdVals = macdLine.map((v) => (v == null ? 0 : v));
  const firstValid = macdLine.findIndex((v) => v != null);
  const signal = new Array(closes.length).fill(null);
  const hist = new Array(closes.length).fill(null);

  if (firstValid < 0 || closes.length - firstValid < signalPeriod) {
    return { macdLine, signal, hist };
  }

  let sum = 0;
  for (let i = firstValid; i < firstValid + signalPeriod; i++) sum += macdVals[i];
  signal[firstValid + signalPeriod - 1] = sum / signalPeriod;
  const k = 2 / (signalPeriod + 1);
  for (let i = firstValid + signalPeriod; i < closes.length; i++) {
    signal[i] = macdVals[i] * k + signal[i - 1] * (1 - k);
  }
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] != null && signal[i] != null) hist[i] = macdLine[i] - signal[i];
  }
  return { macdLine, signal, hist };
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].h;
    const low = candles[i].l;
    const prevClose = candles[i - 1].c;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (trs.length < period) return null;
  let sum = 0;
  for (let i = trs.length - period; i < trs.length; i++) sum += trs[i];
  return sum / period;
}

function mean(nums) {
  const vals = nums.filter((n) => n != null && Number.isFinite(n));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function round(n, d = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function swingLevels(candles, lookback = 40) {
  const slice = candles.slice(-lookback);
  if (slice.length < 10) {
    return { support: null, resistance: null };
  }
  const lows = slice.map((c) => c.l);
  const highs = slice.map((c) => c.h);
  const sortedLows = [...lows].sort((a, b) => a - b);
  const sortedHighs = [...highs].sort((a, b) => a - b);
  const support = mean(sortedLows.slice(0, Math.max(3, Math.floor(sortedLows.length * 0.2))));
  const resistance = mean(
    sortedHighs.slice(-Math.max(3, Math.floor(sortedHighs.length * 0.2)))
  );
  return { support: round(support), resistance: round(resistance) };
}

function hasSignal(a, name) {
  return Array.isArray(a.signals) && a.signals.includes(name);
}

function uniqueReasons(list, max = 8) {
  const out = [];
  for (const r of list || []) {
    if (!r || out.includes(r)) continue;
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/** Stop must sit below price; target above price; entry between stop and target. */
function validLongLevels(price, buy, sell, stop) {
  if ([price, buy, sell, stop].some((n) => n == null || !Number.isFinite(n))) return false;
  return stop < price && price < sell && stop < buy && buy < sell;
}

function rewardRisk(price, sell, stop) {
  const risk = price - stop;
  const reward = sell - price;
  if (risk <= 0 || reward <= 0) return null;
  return round(Math.min(reward / risk, 4), 2);
}

function priceDecimals(price) {
  if (price == null) return 2;
  if (price >= 10) return 2;
  if (price >= 1) return 3;
  return 4;
}

function px(n, price) {
  return round(n, priceDecimals(price));
}

function sessionLevels(price, atr, support, resistance, isBreakout) {
  const band = atr && atr > 0 ? atr : price * 0.02;
  const stopDist = Math.max(band * 0.5, price * 0.01);
  let stop = price - stopDist;
  if (support != null && support < price && price - support <= stopDist * 1.2) {
    stop = Math.min(stop, support * 0.997);
  }
  stop = px(stop, price);

  const minSell = price + (price - stop) * 1.35;
  let sell;
  if (isBreakout) {
    sell = Math.max(minSell, price + band * 0.65);
  } else if (resistance != null && resistance > price) {
    sell = Math.min(resistance * 0.995, price + band * 0.8);
  } else {
    sell = price + band * 0.7;
  }
  sell = px(sell, price);
  const buy = px(price, price);
  return { buy, sell, stop };
}

function confluenceCount(a) {
  return [
    a.considerations?.trend === "up",
    a.considerations?.emaStackBull,
    hasSignal(a, "macd_buy"),
    hasSignal(a, "breakout_volume"),
    hasSignal(a, "exit_accumulation"),
    hasSignal(a, "bounce_setup"),
    hasSignal(a, "high_volume"),
    (a.market?.rsVsMarket ?? 0) >= 1,
    a.depth?.bidCushion,
  ].filter(Boolean).length;
}

function setupFromSignals(a) {
  if (hasSignal(a, "breakout_volume")) return "breakout";
  if (hasSignal(a, "bounce_setup")) return "bounce";
  if (hasSignal(a, "exit_accumulation")) return "accumulation_exit";
  if (hasSignal(a, "macd_buy")) return "macd_cross";
  return "momentum";
}

function hardRiskFlags(a) {
  const flags = [];
  const rsi = a.indicators?.rsi;
  if (a.considerations?.conflict) flags.push("إشارات متعارضة");
  if (hasSignal(a, "false_break_risk")) flags.push("خطر كسر كاذب");
  if (hasSignal(a, "thin_volume") || a.market?.liquidityTier === "low") flags.push("سيولة ضعيفة");
  if (a.considerations?.trend === "down" && !hasSignal(a, "breakout_volume")) flags.push("اتجاه هابط");
  if (rsi != null && rsi > 72 && !hasSignal(a, "breakout_volume")) flags.push("تشبع شرائي");
  if (a.actionHint === "sell") flags.push("إشارة بيع عامة");
  return flags;
}

function refineScalpCandidate(a) {
  const ind = a.indicators || {};
  const cons = a.considerations || {};
  const price = a.price;
  const volX = ind.volumeRatio || 0;
  const atrPct = (ind.atrPct || 0) / 100;
  const isBreakout = hasSignal(a, "breakout_volume");
  let { buy, sell, stop } = sessionLevels(price, ind.atr, ind.support, ind.resistance, isBreakout);
  const d = a.depth;
  if (d?.wallAskPrice != null && d.wallAskPrice > price && !isBreakout) {
    const capped = px(d.wallAskPrice * 0.995, price);
    if (capped > price) sell = Math.min(sell, capped);
  }
  const rr = rewardRisk(price, sell, stop);
  const flags = hardRiskFlags(a);
  const hits = confluenceCount(a);

  let score = 36;
  if (volX >= 1.4) score += 8;
  if (volX >= 2) score += 6;
  if (a.market?.liquidityTier === "high") score += 6;
  if (atrPct >= 0.015 && atrPct <= 0.045) score += 8;
  if (atrPct > 0.06) score -= 6;
  if (cons.trend === "up") score += 10;
  if (cons.emaStackBull) score += 5;
  if (isBreakout) score += 10;
  if (hasSignal(a, "macd_buy")) score += 8;
  if (hasSignal(a, "exit_accumulation")) score += 7;
  if (hasSignal(a, "bounce_setup")) score += 6;
  if (ind.distToResistancePct != null && ind.distToResistancePct >= 3) score += 5;
  if (ind.distToResistancePct != null && ind.distToResistancePct < 1.2 && !isBreakout) score -= 10;
  if (rr != null && rr >= 1.5) score += 6;
  if (rr != null && rr >= 2) score += 4;
  if (hits >= 3) score += 6;
  if (a.score >= 65) score += 4;
  if (d?.bidCushion) score += 8;
  if (d?.ratio != null && d.ratio >= 1.5) score += 4;
  if (d?.pocDistPct != null && d.pocDistPct < -0.3) score += 4;
  if (d?.pocDistPct != null && d.pocDistPct > 1) score -= 5;
  if (d?.thin) score -= 12;
  if (d?.askWall && !isBreakout) score -= 10;
  score -= flags.length * 10;
  score = Math.max(0, Math.min(92, Math.round(score)));

  const eligible =
    flags.length === 0 &&
    hits >= 2 &&
    volX >= 1.35 &&
    atrPct >= 0.012 &&
    validLongLevels(price, buy, sell, stop) &&
    rr != null &&
    rr >= 1.3 &&
    score >= 58 &&
    !(d?.thin);

  const reasons = [];
  if (volX >= 1.4) reasons.push(`سيولة ${round(volX, 1)}× متوسط 20 يوم`);
  if (isBreakout) reasons.push("كسر مقاومة بحجم");
  if (hasSignal(a, "macd_buy")) reasons.push("تقاطع MACD شراء");
  if (hasSignal(a, "bounce_setup")) reasons.push("ارتداد قرب الدعم");
  if (cons.trend === "up") reasons.push("اتجاه صاعد");
  if (d?.bidCushion) reasons.push(`عمق داعم تحت السعر (طلبات/عروض ${d.ratio}:1)`);
  if (d?.askWall && !isBreakout) reasons.push("جدار عروض قريب — صعب المضاربة لأعلى");
  if (d?.pocDistPct != null && d.pocDistPct < -0.3) reasons.push("تركيز الحجم تحت السعر (دعم)");
  if (d?.thin) reasons.push("عمق ضعيف قرب آخر سعر");
  if (rr != null) reasons.push(`عائد/مخاطرة ${rr}:1 من السعر الحالي`);
  if (!eligible) reasons.push(...flags.map((f) => `مستبعد: ${f}`));

  a.scalp = {
    eligible,
    score,
    buy,
    sell,
    stop,
    rr,
    setup: setupFromSignals(a),
    reasons: uniqueReasons(reasons),
  };
  if (eligible && !hasSignal(a, "scalp_session")) a.signals.push("scalp_session");
}

function refineWeekCandidate(a) {
  const cons = a.considerations || {};
  const price = a.price;
  const atr = a.indicators?.atr || price * 0.02;
  const maxStopDist = Math.min(price * 0.07, Math.max(atr * 1.15, price * 0.035));
  let stop = a.trade?.stopLoss;
  if (stop == null || price - stop > maxStopDist) stop = px(price - maxStopDist, price);
  if (stop >= price) stop = px(price - maxStopDist, price);

  const buy = px(a.trade?.entry ?? price, price);
  let sell = a.trade?.target1;
  const minSell = price + (price - stop) * 1.5;
  if (sell == null || sell < minSell) sell = px(minSell, price);
  else sell = px(sell, price);
  const sell2 = a.trade?.target2 != null ? px(a.trade.target2, price) : null;
  const rr = rewardRisk(price, sell, stop);
  const flags = hardRiskFlags(a);
  const hits = confluenceCount(a);

  let score = Math.min(70, a.score || 0);
  if (cons.trend === "up") score += 6;
  if (cons.aboveEma200) score += 4;
  if (cons.emaStackBull) score += 4;
  if (hasSignal(a, "macd_buy")) score += 5;
  if (hasSignal(a, "exit_accumulation")) score += 5;
  if (rr != null && rr >= 1.6) score += 6;
  if (a.market?.rsVsSector != null && a.market.rsVsSector >= 1.5) score += 3;
  if (a.market?.liquidityTier === "low") score -= 8;
  if (a.depth?.bidCushion) score += 5;
  if (a.depth?.thin) score -= 6;
  if (a.depth?.askWall) score -= 6;
  if (a.depth?.pocDistPct != null && a.depth.pocDistPct < -0.5) score += 3;
  score -= flags.length * 8;
  score = Math.max(0, Math.min(92, Math.round(score)));

  const eligible =
    flags.length === 0 &&
    hits >= 2 &&
    cons.trend !== "down" &&
    a.actionHint !== "sell" &&
    validLongLevels(price, buy, sell, stop) &&
    rr != null &&
    rr >= 1.5 &&
    score >= 60;

  const reasons = [];
  if (cons.trend === "up") reasons.push("اتجاه صاعد يناسب أفق أسبوع");
  if (cons.aboveEma200) reasons.push("فوق EMA200");
  if (hasSignal(a, "macd_buy")) reasons.push("MACD يدعم الاستمرار");
  if (a.depth?.bidCushion) reasons.push(`عمق داعم تحت السعر (${a.depth.ratio}:1)`);
  if (rr != null) reasons.push(`عائد/مخاطرة ${rr}:1 للهدف الأول`);
  if (!eligible) reasons.push(...flags.map((f) => `مستبعد: ${f}`));

  a.week = {
    eligible,
    score,
    buy,
    sell,
    sell2,
    stop,
    rr,
    setup: setupFromSignals(a),
    reasons: uniqueReasons(reasons),
  };
}

export function applyFundamentalPlanBoost(plan, fundamentals) {
  if (!plan || !fundamentals) return plan;
  let score = plan.score;
  const reasons = [...(plan.reasons || [])];
  const f = fundamentals;

  if (f.marketCap != null && f.marketCap >= 5e9) {
    score += 4;
    reasons.push("قيمة سوقية كبيرة — سيولة أفضل");
  } else if (f.marketCap != null && f.marketCap < 3e8) {
    score -= 8;
    reasons.push("قيمة سوقية صغيرة — مخاطرة سيولة");
  }
  if (f.eps != null && f.eps < 0) {
    score -= 6;
    reasons.push("EPS سالب");
  }
  if (f.pe != null && f.pe < 0) {
    score -= 5;
    reasons.push("P/E سالب");
  }
  if (f.pe != null && f.pe > 0 && f.pe <= 12 && f.eps != null && f.eps > 0) {
    score += 3;
    reasons.push(`P/E ${round(f.pe, 1)} مع أرباح موجبة`);
  }

  score = Math.max(0, Math.min(92, Math.round(score)));
  const tinyCap = f.marketCap != null && f.marketCap < 3e8;
  return {
    ...plan,
    score,
    eligible: Boolean(plan.eligible) && score >= 58 && !tinyCap,
    reasons: uniqueReasons(reasons),
  };
}

export function applyFundamentalScalpBoost(item) {
  if (!item?.fundamentals) return item;
  return {
    ...item,
    scalp: item.scalp ? applyFundamentalPlanBoost(item.scalp, item.fundamentals) : item.scalp,
    week: item.week ? applyFundamentalPlanBoost(item.week, item.fundamentals) : item.week,
  };
}

function isConsolidating(candles, window = 15, maxRangePct = 0.08) {
  const slice = candles.slice(-(window + 1), -1);
  if (slice.length < window) return false;
  const highs = slice.map((c) => c.h);
  const lows = slice.map((c) => c.l);
  const hi = Math.max(...highs);
  const lo = Math.min(...lows);
  const mid = (hi + lo) / 2 || 1;
  return (hi - lo) / mid <= maxRangePct;
}

/**
 * Analyze one quote with multi-factor technicals.
 * Weighs trend, EMAs, RSI, MACD, volume, S/R, ATR risk, R:R, momentum, and conflicts.
 */
export function analyzeQuote(quote) {
  const candles = quote.candles || [];
  if (candles.length < 30) return null;

  const closes = candles.map((c) => c.c);
  const volumes = candles.map((c) => (c.v == null ? 0 : c.v));
  const price = last(closes);
  const prev = closes[closes.length - 2];
  const close5 = closes.length >= 6 ? closes[closes.length - 6] : null;

  const ema20Arr = emaSeries(closes, 20);
  const ema50Arr = emaSeries(closes, 50);
  const ema200Arr = closes.length >= 200 ? emaSeries(closes, 200) : null;
  const rsiArr = rsiSeries(closes, 14);
  const { macdLine, signal, hist } = macdSeries(closes);
  const { support, resistance } = swingLevels(candles);
  const atr14 = atr(candles, 14);
  const consolidating = isConsolidating(candles);

  const ema20 = last(ema20Arr);
  const ema50 = last(ema50Arr);
  const ema200 = ema200Arr ? last(ema200Arr) : null;
  const rsi = last(rsiArr);
  const macd = last(macdLine);
  const macdSignal = last(signal);
  const macdHist = last(hist);
  const prevHist = hist[hist.length - 2];

  const avgVol20 = mean(volumes.slice(-21, -1));
  const lastVol = last(volumes) || 0;
  const volumeRatio = avgVol20 ? lastVol / avgVol20 : null;

  const trend =
    ema20 != null && ema50 != null
      ? price > ema20 && ema20 > ema50
        ? "up"
        : price < ema20 && ema20 < ema50
          ? "down"
          : "sideways"
      : "unknown";

  const emaStackBull =
    ema20 != null && ema50 != null && (ema200 == null || ema20 > ema50) && price > ema20 && ema20 > ema50;
  const aboveEma200 = ema200 != null && price > ema200;
  const belowEma200 = ema200 != null && price < ema200;

  const macdBuy =
    macd != null &&
    macdSignal != null &&
    prevHist != null &&
    macdHist != null &&
    prevHist <= 0 &&
    macdHist > 0;

  const macdSell =
    macd != null &&
    macdSignal != null &&
    prevHist != null &&
    macdHist != null &&
    prevHist >= 0 &&
    macdHist < 0;

  const rsiOversold = rsi != null && rsi < 30;
  const rsiOverbought = rsi != null && rsi > 70;
  const rsiNeutral = rsi != null && rsi >= 40 && rsi <= 60;

  const distToSupportPct =
    support != null && price ? round(((price - support) / price) * 100, 2) : null;
  const distToResistancePct =
    resistance != null && price ? round(((resistance - price) / price) * 100, 2) : null;
  const rangeSpan =
    support != null && resistance != null && resistance > support ? resistance - support : null;
  const rangePosition =
    rangeSpan && support != null ? round((price - support) / rangeSpan, 2) : null;

  const atrPct = atr14 && price ? atr14 / price : 0;
  const momentum5 =
    close5 != null && close5 !== 0 ? round(((price - close5) / close5) * 100, 2) : null;
  const chgPct = quote.changePercent ?? null;
  const chgAbs = Math.abs(chgPct ?? 0);

  const nearSupport =
    distToSupportPct != null && distToSupportPct >= 0 && distToSupportPct <= 2.5;
  const nearResistance =
    distToResistancePct != null && distToResistancePct >= 0 && distToResistancePct <= 2.5;
  const stretchedUp = rangePosition != null && rangePosition >= 0.85;
  const roomToRun = distToResistancePct != null && distToResistancePct >= 3;

  const brokeResistance =
    resistance != null &&
    prev != null &&
    prev < resistance &&
    price >= resistance &&
    volumeRatio != null &&
    volumeRatio >= 1.5;

  const falseBreakRisk =
    resistance != null &&
    prev != null &&
    price >= resistance &&
    volumeRatio != null &&
    volumeRatio < 1.1;

  const exitedAccumulation =
    consolidating &&
    resistance != null &&
    price > resistance &&
    volumeRatio != null &&
    volumeRatio >= 1.3;

  const bounceSetup =
    nearSupport && trend !== "down" && (rsiOversold || (rsi != null && rsi < 45));

  const signals = [];
  if (rsiOversold) signals.push("rsi_oversold");
  if (rsiOverbought) signals.push("rsi_overbought");
  if (macdBuy) signals.push("macd_buy");
  if (macdSell) signals.push("macd_sell");
  if (brokeResistance) signals.push("breakout_volume");
  if (falseBreakRisk) signals.push("false_break_risk");
  if (exitedAccumulation) signals.push("exit_accumulation");
  if (consolidating) signals.push("consolidation");
  if (trend === "up") signals.push("trend_up");
  if (trend === "down") signals.push("trend_down");
  if (volumeRatio != null && volumeRatio >= 2) signals.push("high_volume");
  if (volumeRatio != null && volumeRatio < 0.6) signals.push("thin_volume");
  if (aboveEma200) signals.push("above_ema200");
  if (belowEma200) signals.push("below_ema200");
  if (nearSupport) signals.push("near_support");
  if (nearResistance) signals.push("near_resistance");
  if (bounceSetup) signals.push("bounce_setup");
  if (stretchedUp) signals.push("extended_up");

  let score = 42;
  // Trend / structure
  if (trend === "up") score += 14;
  if (trend === "down") score -= 14;
  if (trend === "sideways") score -= 2;
  if (emaStackBull) score += 8;
  if (aboveEma200) score += 6;
  if (belowEma200 && trend === "down") score -= 6;
  if (ema20 != null && price > ema20) score += 4;
  if (ema50 != null && price > ema50) score += 3;
  // Momentum oscillators
  if (macdBuy) score += 12;
  if (macdSell) score -= 10;
  if (macdHist != null && macdHist > 0 && !macdSell) score += 3;
  if (macdHist != null && macdHist < 0 && !macdBuy) score -= 3;
  if (rsiOversold && trend !== "down") score += 12;
  if (rsiOversold && trend === "down") score += 4;
  if (rsiOverbought && !brokeResistance) score -= 10;
  if (rsiOverbought && brokeResistance) score -= 3;
  if (rsiNeutral && trend === "up") score += 2;
  // Volume / breakout / accumulation
  if (brokeResistance) score += 14;
  if (falseBreakRisk) score -= 8;
  if (exitedAccumulation) score += 12;
  if (volumeRatio != null && volumeRatio >= 1.5) score += 7;
  if (volumeRatio != null && volumeRatio >= 2.5) score += 4;
  if (volumeRatio != null && volumeRatio < 0.6) score -= 6;
  // Location vs S/R + risk
  if (bounceSetup) score += 8;
  if (nearResistance && !brokeResistance && rsiOverbought) score -= 8;
  if (roomToRun && trend === "up") score += 4;
  if (stretchedUp && !brokeResistance) score -= 5;
  if (momentum5 != null && momentum5 >= 6 && !brokeResistance) score -= 4;
  if (momentum5 != null && momentum5 <= -8 && rsiOversold) score += 3;
  // Conflict penalty: bullish motif vs heavy sell signals
  const bullHits = [macdBuy, brokeResistance, trend === "up", rsiOversold && trend !== "down"].filter(Boolean).length;
  const bearHits = [macdSell, trend === "down", rsiOverbought && !brokeResistance, belowEma200].filter(Boolean).length;
  if (bullHits >= 2 && bearHits >= 2) score -= 8;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const risk = atr14 || (support != null ? Math.max(price - support, price * 0.02) : price * 0.03);
  const entry = round(price);
  let stopLoss = round(
    Math.min(price - risk * 1.2, support != null ? support * 0.985 : price - risk)
  );
  if (stopLoss >= entry) stopLoss = round(entry * 0.97);
  const riskPerShare = Math.max(entry - stopLoss, price * 0.015);
  let target1 = round(entry + riskPerShare * 1.5);
  let target2 = round(entry + riskPerShare * 2.5);
  // Cap targets near resistance when not breaking out — only if room keeps usable R:R
  if (resistance != null && !brokeResistance && target1 > resistance) {
    const capped = round(resistance * 0.995);
    if (capped > entry + riskPerShare * 1.05) target1 = capped;
  }
  if (resistance != null && !brokeResistance && target2 > resistance * 1.02) {
    const capped2 = round(resistance * 1.02);
    if (capped2 > target1) target2 = capped2;
  }
  const reward1 = target1 - entry;
  let riskReward = riskPerShare > 0 ? round(reward1 / riskPerShare, 2) : null;
  if (riskReward != null && riskReward < 1.2) score = Math.max(0, score - 10);
  if (riskReward != null && riskReward >= 2) score = Math.min(100, score + 3);
  if (nearResistance && !brokeResistance && (distToResistancePct == null || distToResistancePct < 2)) {
    score = Math.max(0, score - 6);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  let actionHint = score >= 60 ? "buy" : score <= 35 ? "sell" : "hold";
  if (actionHint === "buy" && riskReward != null && riskReward < 1.2) actionHint = "hold";
  if (actionHint === "buy" && bullHits >= 2 && bearHits >= 2) actionHint = "hold";
  if (
    actionHint === "buy" &&
    nearResistance &&
    !brokeResistance &&
    rsiOverbought
  ) {
    actionHint = "hold";
  }
  if (actionHint === "buy" && volumeRatio != null && volumeRatio < 0.6) actionHint = "hold";

  const reasons = [];
  if (trend === "up") reasons.push("اتجاه صاعد (السعر فوق EMA20 وEMA50 مرتبة)");
  if (trend === "down") reasons.push("اتجاه هابط تحت المتوسطات");
  if (aboveEma200) reasons.push("فوق EMA200 (هيكل متوسط/طويل أقوى)");
  if (belowEma200) reasons.push("تحت EMA200 — الاتجاه الأوسع ضعيف");
  if (macdBuy) reasons.push("MACD أعطى تقاطع شراء");
  if (macdSell) reasons.push("MACD أعطى تقاطع بيع");
  if (rsiOversold) reasons.push(`RSI منخفض (${round(rsi, 1)}) — ارتداد محتمل مع تأكيد`);
  if (rsiOverbought) reasons.push(`RSI مرتفع (${round(rsi, 1)}) — تشبع شرائي / حذر`);
  if (brokeResistance) reasons.push("كسر مقاومة بحجم تداول مرتفع");
  if (falseBreakRisk) reasons.push("قرب/كسر مقاومة بحجم ضعيف — خطر كسر كاذب");
  if (exitedAccumulation) reasons.push("خروج من تجميع مع حجم");
  if (bounceSetup) reasons.push("قرب دعم مع RSI مناسب لسيناريو ارتداد");
  if (nearResistance && !brokeResistance) reasons.push(`قرب مقاومة (${distToResistancePct}%)`);
  if (volumeRatio != null && volumeRatio >= 1.5) {
    reasons.push(`حجم اليوم ${round(volumeRatio, 1)}× متوسط 20 يوم`);
  }
  if (volumeRatio != null && volumeRatio < 0.6) reasons.push("سيولة ضعيفة اليوم — ثقة أقل");
  if (atrPct >= 0.03) reasons.push(`تذبذب مرتفع (ATR ${(atrPct * 100).toFixed(1)}%) — مخاطرة أكبر`);
  if (riskReward != null) reasons.push(`عائد/مخاطرة تقريبي للهدف1 ≈ ${riskReward}:1`);
  if (bullHits >= 2 && bearHits >= 2) reasons.push("إشارات متعارضة — خفض الثقة");
  if (!reasons.length) reasons.push("إشارات مختلطة — راقب المستوى والحجم");

  const company = buildCompanyProfile(quote);

  return {
    ticker: quote.ticker,
    nameAr: quote.nameAr || quote.name || "",
    nameEn: quote.nameEn || quote.name || "",
    price: round(price),
    changePercent: chgPct,
    currency: quote.currency || "EGP",
    company,
    indicators: {
      rsi: round(rsi, 1),
      macd: round(macd, 4),
      macdSignal: round(macdSignal, 4),
      macdHist: round(macdHist, 4),
      ema20: round(ema20),
      ema50: round(ema50),
      ema200: round(ema200),
      support,
      resistance,
      atr: round(atr14),
      atrPct: round(atrPct * 100, 2),
      volumeRatio: round(volumeRatio, 2),
      trend,
      distToSupportPct,
      distToResistancePct,
      rangePosition,
      momentum5,
      riskReward,
    },
    signals,
    score,
    actionHint,
    considerations: {
      trend,
      emaStackBull,
      aboveEma200,
      volumeConfirmed: volumeRatio != null && volumeRatio >= 1.5,
      rsiZone: rsiOversold ? "oversold" : rsiOverbought ? "overbought" : "neutral",
      macdState: macdBuy
        ? "buy_cross"
        : macdSell
          ? "sell_cross"
          : macdHist != null && macdHist > 0
            ? "hist_pos"
            : "hist_neg",
      location: brokeResistance
        ? "breakout"
        : nearSupport
          ? "near_support"
          : nearResistance
            ? "near_resistance"
            : consolidating
              ? "consolidation"
              : "mid_range",
      liquidity:
        volumeRatio != null && volumeRatio < 0.6
          ? "thin"
          : volumeRatio != null && volumeRatio >= 2
            ? "hot"
            : "normal",
      volatility: atrPct >= 0.03 ? "high" : atrPct >= 0.015 ? "medium" : "low",
      conflict: bullHits >= 2 && bearHits >= 2,
      riskReward,
      sector: company.sectorId,
      currency: company.currency,
      usdListed: company.usdListed,
    },
    trade: {
      entry,
      stopLoss,
      target1,
      target2,
      confidence: score,
      riskReward,
    },
    scalp: null,
    reasons: [
      ...reasons,
      ...(company.notes || []).slice(0, 2),
    ].slice(0, 8),
  };
}

export function analyzeUniverse(quotes) {
  const base = (quotes || []).map(analyzeQuote).filter(Boolean);
  return enrichWithMarketContext(base, quotes || []);
}

function median(nums) {
  const vals = nums.filter((n) => n != null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/**
 * Add company + market surroundings: sector peers, RS vs market/sector, liquidity tier.
 */
export function enrichWithMarketContext(analyses, quotes) {
  if (!analyses.length) return analyses;

  const byTicker = new Map((quotes || []).map((q) => [q.ticker, q]));
  const marketMedChg = median(analyses.map((a) => a.changePercent));
  const volSorted = [...analyses]
    .map((a) => a.indicators?.volumeRatio)
    .filter((v) => v != null)
    .sort((a, b) => a - b);

  const sectorBuckets = new Map();
  for (const a of analyses) {
    const q = byTicker.get(a.ticker) || a;
    const company = a.company || buildCompanyProfile(q);
    a.company = company;
    const sid = company.sectorId || "other";
    if (!sectorBuckets.has(sid)) sectorBuckets.set(sid, []);
    sectorBuckets.get(sid).push(a);
  }

  const sectorMed = new Map();
  for (const [sid, list] of sectorBuckets) {
    sectorMed.set(sid, median(list.map((a) => a.changePercent)));
  }

  for (const a of analyses) {
    const company = a.company;
    const peers = sectorBuckets.get(company.sectorId) || [a];
    const peerMed = sectorMed.get(company.sectorId);
    const rsMarket =
      a.changePercent != null && marketMedChg != null
        ? round(a.changePercent - marketMedChg, 2)
        : null;
    const rsSector =
      a.changePercent != null && peerMed != null ? round(a.changePercent - peerMed, 2) : null;

    let liquidityTier = "unknown";
    const volX = a.indicators?.volumeRatio;
    if (volX != null && volSorted.length) {
      const rank = volSorted.filter((v) => v <= volX).length / volSorted.length;
      liquidityTier = rank >= 0.75 ? "high" : rank <= 0.25 ? "low" : "mid";
    }

    const market = {
      universeSize: analyses.length,
      marketMedianChg: round(marketMedChg, 2),
      sectorMedianChg: round(peerMed, 2),
      rsVsMarket: rsMarket,
      rsVsSector: rsSector,
      sectorPeerCount: peers.length,
      sectorLeaders: [...peers]
        .sort((x, y) => (y.score || 0) - (x.score || 0))
        .slice(0, 3)
        .map((p) => p.ticker.replace(/\.CA$/i, "")),
      liquidityTier,
    };

    a.market = market;
    a.considerations = {
      ...(a.considerations || {}),
      sector: company.sectorId,
      currency: company.currency,
      usdListed: company.usdListed,
      rsVsMarket: rsMarket,
      rsVsSector: rsSector,
      liquidityTier,
      peerCount: peers.length,
    };

    // Surroundings score nudges (keep logical, small)
    let adj = 0;
    if (rsMarket != null && rsMarket >= 1.5 && a.considerations.volumeConfirmed) adj += 3;
    if (rsMarket != null && rsMarket <= -2 && a.considerations.trend === "down") adj -= 3;
    if (liquidityTier === "low") adj -= 4;
    if (liquidityTier === "high" && a.considerations.volumeConfirmed) adj += 2;
    if (company.usdListed && a.indicators?.atrPct >= 3) adj -= 2;
    if (rsSector != null && rsSector >= 2 && a.signals.includes("breakout_volume")) adj += 2;
    if (rsSector != null && rsSector < -1.5 && a.signals.includes("extended_up")) adj -= 3;

    a.score = Math.max(0, Math.min(100, Math.round((a.score || 0) + adj)));
    let actionHint = a.score >= 60 ? "buy" : a.score <= 35 ? "sell" : "hold";
    const rr = a.indicators?.riskReward ?? a.considerations?.riskReward;
    if (actionHint === "buy" && rr != null && rr < 1.2) actionHint = "hold";
    if (actionHint === "buy" && a.considerations?.conflict) actionHint = "hold";
    if (
      actionHint === "buy" &&
      a.considerations?.rsiZone === "overbought" &&
      a.considerations?.location === "near_resistance" &&
      !a.signals.includes("breakout_volume")
    ) {
      actionHint = "hold";
    }
    if (actionHint === "buy" && liquidityTier === "low") actionHint = "hold";
    a.actionHint = actionHint;
    a.trade = { ...a.trade, confidence: a.score };

    if (company.notes?.length) {
      for (const note of company.notes.slice(0, 2)) {
        if (!a.reasons.includes(note)) a.reasons = [...a.reasons, note].slice(0, 8);
      }
    }
    if (rsMarket != null) {
      const note =
        rsMarket >= 0
          ? `أقوى من وسيط السوق بـ ${rsMarket}% تقريباً`
          : `أضعف من وسيط السوق بـ ${Math.abs(rsMarket)}% تقريباً`;
      if (!a.reasons.some((r) => r.includes("وسيط السوق"))) {
        a.reasons = [...a.reasons, note].slice(0, 8);
      }
    }
    if (peers.length >= 3) {
      a.reasons = [
        ...a.reasons,
        `القطاع (${company.sectorAr}): ${peers.length} أقران في العينة`,
      ].slice(0, 8);
    }

    const quote = byTicker.get(a.ticker);
    a.depth = summarizeDepth(buildPriceDepth(quote || a, { levels: 10 }));

    refineScalpCandidate(a);
    refineWeekCandidate(a);
  }

  return analyses;
}

const SCREENS = {
  top: {
    id: "top",
    filter: () => true,
    sort: (a, b) => b.score - a.score,
  },
  rsi: {
    id: "rsi",
    filter: (a) => a.signals.includes("rsi_oversold"),
    sort: (a, b) => (a.indicators.rsi ?? 100) - (b.indicators.rsi ?? 100),
  },
  macd: {
    id: "macd",
    filter: (a) => a.signals.includes("macd_buy"),
    sort: (a, b) => b.score - a.score,
  },
  breakout: {
    id: "breakout",
    filter: (a) => a.signals.includes("breakout_volume"),
    sort: (a, b) => (b.indicators.volumeRatio || 0) - (a.indicators.volumeRatio || 0),
  },
  accumulation: {
    id: "accumulation",
    filter: (a) => a.signals.includes("exit_accumulation"),
    sort: (a, b) => b.score - a.score,
  },
  scalp: {
    id: "scalp",
    filter: (a) => a.scalp?.eligible,
    sort: (a, b) => (b.scalp?.score || 0) - (a.scalp?.score || 0) || (b.scalp?.rr || 0) - (a.scalp?.rr || 0),
  },
  week: {
    id: "week",
    filter: (a) => a.week?.eligible,
    sort: (a, b) => (b.week?.score || 0) - (a.week?.score || 0) || (b.week?.rr || 0) - (a.week?.rr || 0),
  },
};

export function scanAnalyses(analyses, type = "top", limit = 10) {
  const screen = SCREENS[type] || SCREENS.top;
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  return analyses.filter(screen.filter).sort(screen.sort).slice(0, n);
}

export function compactForAi(analyses, limit = 40) {
  const ranked = [...analyses].sort((a, b) => b.score - a.score).slice(0, limit);
  return ranked.map((a) => ({
    ticker: a.ticker.replace(/\.CA$/i, ""),
    nameAr: a.nameAr,
    nameEn: a.nameEn,
    sector: a.company?.sectorAr || a.company?.sectorId,
    currency: a.company?.currency || a.currency,
    price: a.price,
    chgPct: a.changePercent,
    score: a.score,
    action: a.actionHint,
    rsi: a.indicators.rsi,
    trend: a.indicators.trend,
    ema20: a.indicators.ema20,
    ema50: a.indicators.ema50,
    ema200: a.indicators.ema200,
    macdBuy: a.signals.includes("macd_buy"),
    macdSell: a.signals.includes("macd_sell"),
    rsiOversold: a.signals.includes("rsi_oversold"),
    rsiOverbought: a.signals.includes("rsi_overbought"),
    breakout: a.signals.includes("breakout_volume"),
    falseBreakRisk: a.signals.includes("false_break_risk"),
    exitAccum: a.signals.includes("exit_accumulation"),
    nearSupport: a.signals.includes("near_support"),
    nearResistance: a.signals.includes("near_resistance"),
    volX: a.indicators.volumeRatio,
    atrPct: a.indicators.atrPct,
    distSup: a.indicators.distToSupportPct,
    distRes: a.indicators.distToResistancePct,
    rangePos: a.indicators.rangePosition,
    mom5: a.indicators.momentum5,
    rr: a.indicators.riskReward,
    support: a.indicators.support,
    resistance: a.indicators.resistance,
    entry: a.trade.entry,
    sl: a.trade.stopLoss,
    t1: a.trade.target1,
    t2: a.trade.target2,
    scalpBuy: a.scalp?.buy,
    scalpSell: a.scalp?.sell,
    scalpStop: a.scalp?.stop,
    scalpScore: a.scalp?.score,
    scalpEligible: a.scalp?.eligible,
    weekBuy: a.week?.buy,
    weekSell: a.week?.sell,
    weekStop: a.week?.stop,
    weekScore: a.week?.score,
    weekEligible: a.week?.eligible,
    market: a.market,
    considerations: a.considerations,
    reasons: a.reasons.slice(0, 5),
    signals: a.signals.slice(0, 10),
  }));
}

export { SCREENS };
