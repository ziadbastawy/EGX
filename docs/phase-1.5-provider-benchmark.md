# Phase 1.5 — EGX Market Data Provider Benchmark & Validation

**Date:** 22 August 2026  
**Scope:** Investigation / benchmark only. No production code, config, schema, or pipeline changes.  
**Isolated fetches:** `/tmp` scripts only.  
**Visual scorecard:** Cursor canvas `phase-1-5-provider-benchmark.canvas.tsx`

**Recommendation: Option E** — keep Mubasher as the temporary production source and build a provider-adapter + validation store before replacing anything. No other vendor produced comparable OHLCV in this test.

---

## 1. Benchmark universe (16 names + EGX30 attempt)

| EGX | Company | Sleeve | Mubasher | Yahoo | EODHD (docs) | Twelve Data (list TESTED) |
|---|---|---|---|---|---|---|
| COMI | CIB | Banks | COMI | COMI.CA | COMI.EGX | **EGS60121C018** (not `COMI`) |
| ADIB | ADIB-Egypt | Banks | ADIB | ADIB.CA | ADIB.EGX | ISIN on EGX list |
| SWDY | El Sewedy | Industrials | SWDY | SWDY.CA | SWDY.EGX | ISIN |
| FWRY | Fawry | Fintech | FWRY | FWRY.CA | FWRY.EGX | ISIN |
| EAST | Eastern Co. | Consumer | EAST | EAST.CA | EAST.EGX | ISIN |
| ORAS | Orascom Construction | Industrials | ORAS | ORAS.CA | ORAS.EGX | ISIN |
| ABUK | Abu Qir Fertilizers | Chemicals | ABUK | ABUK.CA | ABUK.EGX | ISIN |
| MFPC | MOPCO | Chemicals | MFPC | MFPC.CA | MFPC.EGX | ISIN |
| TMGH | Talaat Moustafa | Real estate | TMGH | TMGH.CA | TMGH.EGX | ISIN |
| PHDC | Palm Hills | Real estate | PHDC | PHDC.CA | PHDC.EGX | ISIN |
| ETEL | Telecom Egypt | Telecom | ETEL | ETEL.CA | ETEL.EGX | ISIN |
| HRHO | EFG Holding | Financials | HRHO | HRHO.CA | HRHO.EGX | ISIN |
| JUFO | Juhayna | Food | JUFO | JUFO.CA | JUFO.EGX | ISIN |
| EFIH | e-finance | Fintech | EFIH | EFIH.CA | EFIH.EGX | ISIN |
| CIRA | CIRA | Education | CIRA | CIRA.CA | CIRA.EGX | ISIN |
| ORWE | Oriental Weavers | Industrials | ORWE | ORWE.CA | ORWE.EGX | ISIN |
| EGX30 | Index | Index | **not in Mubasher stock API** | `^CASE30` / `EGX30.CA` **429 this run** | docs: index products exist | **Not Verified** |

Repo still uses Yahoo-style `TICKER.CA`. Twelve Data’s public `/stocks?exchange=EGX` list is **ISIN-first** (257 names). Mapping is not 1:1 with Reuters codes.

---

## 2. Mubasher baseline — TESTED

Endpoints actually called:

- Quote: `GET https://www.mubasher.info/api/1/markets/EGX/stocks/{CODE}`
- History: `stocks[0].historicalFileUrl` CSV
- Fundamentals in-app: HTML scrape (`fetchMubasherStock`), local file `fundamentals.json` dated **2026-08-17**

**All 16 quotes + CSVs returned HTTP 200.** Last tape timestamp **2026-08-20 ~13:27–13:29** (Cairo wall clock in `updatedAt`). Fetch date was Saturday 22 Aug → this is **last cash session (Thu)**, not live Saturday data.

### Live `priceBar` (selected)

| EGX | Last | Prev (`bar.close`) | Change / % (bar) | Volume | updatedAt |
|---|---:|---:|---|---:|---|
| COMI | 138.03 | 136 | +1 / +0.74% | 4,705,023 | 2026-08-20 13:29:52 |
| SWDY | 116.51 | 118.11 | −2.11 / −1.79% | 649,885 | 2026-08-20 13:27:49 |
| FWRY | 19.20 | 19 | +0.21 / +1.11% | 4,481,226 | 2026-08-20 13:29:56 |
| TMGH | 96.54 | 97 | +0.70 / +0.72% | 2,176,618 | 2026-08-20 13:29:42 |
| ABUK | 75.86 | 76 | −0.48 / −0.63% | 997,331 | 2026-08-20 13:29:40 |
| ADIB | 54.00 | 53.86 | −0.44 / −0.82% | 1,581,730 | 2026-08-20 13:27:02 |

**Internal inconsistency (TESTED):** for COMI, `(138.03−136)/136 = +1.49%`, but `changePercentage` is **0.74** and `change` is **1**. Same pattern on ADIB (last 54 vs prev 53.86 should be **+0.26%**, bar says **−0.82%**). **Do not treat Mubasher change fields as ground truth.** Prefer last vs previous close computed yourself — and even then last ≠ CSV close (below).

### Historical CSV — what is actually there

Code `range` filters (5d–max) are client-side. The file is a **long daily series**, not 3 months.

| EGX | Bars | First | Last | Span |
|---|---:|---|---|---:|
| COMI, ADIB, EAST, ABUK, HRHO, ORWE | ~5.9k–6.1k | 2001-05 | 2026-08-20 | **~25.3y** |
| ETEL | 4990 | 2005-12 | 2026-08-20 | ~20.7y |
| SWDY | 4859 | 2006-05 | 2026-08-20 | ~20.2y |
| TMGH / PHDC | 4.4k–4.5k | 2007–08 | 2026-08-20 | ~18y |
| JUFO | 3827 | 2010-06 | 2026-08-20 | ~16y |
| ORAS | 2757 | 2015-03 | 2026-08-20 | ~11.4y |
| MFPC | 2392 | 2016-09 | 2026-08-20 | ~10y |
| FWRY | 1692 | 2019-08 | 2026-08-20 | ~7.0y |
| EFIH | 1157 | 2021-10 | 2026-08-20 | ~4.8y |

Target dates **2026-08-20, 2026-07-20, 2026-05-20, 2025-08-20** all hit exactly on COMI. **2021-08-20** landed on **2021-08-19** (Thu vs Fri — EGX calendar). **1W/1M as weekly bars: not offered** — only daily rows.

Adjustment: **Unknown.** 2001 COMI close **0.62** vs 2026 **137** is consistent with **unadjusted (or split-folded) long history**, not a clean split-adjusted modern series. **Cause not fully verified** (splits likely in the path).

### Live last vs CSV last close (same O/H/L/V)

| EGX | Live last | CSV C | Gap |
|---|---:|---:|---:|
| COMI | 138.03 | 137 | +1.03 |
| ADIB | 54.00 | 53.42 | +0.58 |
| SWDY | 116.51 | 116 | +0.51 |
| ORAS | 757.19 | 759 | −1.81 |
| TMGH | 96.54 | 97.70 | −1.16 |
| JUFO | 26.71 | 26.71 | 0 |

OHL and volume **match**. Gap is **last trade vs official/VWAP/close definition**. Repo scrape **overwrites CSV last bar with live `value`**, so the app’s “close” is the live last, not the CSV close. **Cause not verified beyond that.**

### Fundamentals — TESTED via local scrape file

Present: PE, EPS, PB, book value, market cap, shares, capital, par, currency.  
**Absent:** revenue, net income, ROE, debt, dividends, PEG, EV/EBITDA.

Stale: file **2026-08-17** vs prices **2026-08-20**. MFPC **EPS = 0** (suspicious). ORAS **PE missing**. Period/TTM vs annual: **not in payload**.

License: **not verified** (unofficial JSON + CSV + HTML).

Freshness: **EOD / delayed session tape**, not real-time Saturday. Marketing “15m delay” on AI prompts was **not measured** this run.

Reliability: unofficial, no auth, CSV + HTML, watch `ECONNRESET` can kill `npm run dev`. Quote ~0.5–0.8s; CSV ~0.5s, COMI CSV ~302 KB.

---

## 3. Yahoo — TESTED this run: HTTP 429

`COMI.CA`, `SWDY.CA`, `^CASE30` (query1 chart) all returned **429 Too Many Requests**. No OHLCV collected.

Prior repo evidence (Phase 0 / Render): unofficial `query1.finance.yahoo.com/v8/finance/chart/{TICKER}.CA?interval=1d`. **Not re-verified today.**

**Role from this evidence:** not primary. At best **opportunistic fallback**. **Do not** treat as historical foundation (rate limit + ToS + `.CA` mapping).

Adjusted close / splits: **Not Verified this run** (`events=div,splits` never returned a body).

---

## 4. EGX official — TESTED blocked

`https://www.egx.com.eg/en/ListedStocks.aspx` → fetch failed. Search hits “Request Rejected” / captcha on reports. **No official public API found.** Pages/reports exist for humans. Role: **symbol master / CA files only if you obtain licensed downloads**, not a programmatic primary.

---

## 5. EGX.news — TESTED webpage

`https://www.egx.news/ar` HTTP 200, Next.js news UI, stock logos. **No quote/OHLCV/L2 API discovered.** News site, not a market-data vendor.

---

## 6. EGXpilot — DOCS vs TESTED

Docs (`egxpilot.com/developers.html`): `/api/stocks/:symbol`, AI analysis, “golden stocks”.  
**TESTED:** those URLs **404** (Apache). Product is **AI/signals first**. Not a usable raw-data feed in this test.

---

## 7. EGXAPI — DOCS vs TESTED

Docs: `api.egxapi.com/v2`, paper trading, bars/quotes, **key required**. Pricing page: free API, 3000 req/min (marketing).  
**TESTED:** Cloudflare **530 / Error 1033** (tunnel origin down). **Not usable now.** Even when up, it is a **broker/execution API**, not a proven historical research store.

---

## 8. EODHD — DOCS + auth wall

- Exchange page: **241** EGX tickers; **COMI.EGX** listed (**TESTED HTML**). SWDY string not on first page (**incomplete page scrape, not proof of absence**).
- API without token: **401 Unauthenticated** (**TESTED**).
- Pricing page **2026-08-22**: EOD All World **$19.99/mo**; All-in-one **$99.99/mo**; live **15m delayed** on paid; free **20 calls/day**, **1y** history. Non-US EOD “mostly from 2000”. Adjusted/dividends claimed on paid plans. **License: commercial paid; AI/ML storage — not verified beyond their site.**

**OHLCV vs Mubasher: Not Verified (no key).**

---

## 9. Twelve Data — LIST TESTED; series NOT

- `GET /stocks?exchange=EGX` **200**, **257** names, symbols = **ISINs** (`EGS…`). COMI = `EGS60121C018`.
- `symbol_search?symbol=COMI` returns **Romanian BVB COMI**, not EGX.
- `/time_series` without apikey: **401**.
- Pricing page: Basic free **8 credits/min**; Grow from **$29/mo**; EGX listed under XCAI. Delay field on exchange page: **“–”**. Individual plans: **personal / internal / non-commercial** wording on pricing.

**Cannot score OHLCV quality. Symbol convention is a real integration cost.**

---

## 10. ICE — DOCUMENTATION-VERIFIED only

ICE Developer catalog: EGX on Consolidated Feed / History / Data API; L1/L2; up to **15y tick history**. Enterprise contract. **Not appropriate** as the DIY PM foundation.

---

## 11. Other (EGX evidence only)

| Name | Evidence | Verdict |
|---|---|---|
| **Oanor “EGX API”** | Docs: live quote; **401** without key; **docs say upstream TradingView scanner** | Out of scope (TV republish) |
| **EGXLytics / egxpy** | Marketing + site 200 | **Not tested** as API |
| **borsa** (GitHub) | Wrapper over Yahoo etc. | Not a new source |
| **Starta Markets directory** | Webpage prices **as of 17 Aug 2026** (COMI 138.85) | **Different session** vs our 20 Aug tape — not a same-day cross-check |

TradingView was **not** treated as an official market-data API.

---

## 12. Cross-comparison

**Same-day multi-provider OHLCV table cannot be filled** except Mubasher (Yahoo 429; others no key / down).

Same-name, **different day** (do not treat as error): Starta **17 Aug** COMI **138.85** vs Mubasher **20 Aug** **138.03**.

**Mubasher vs itself** is the only hard discrepancy (change% and last vs CSV close). Likely **field semantics**, not two vendors.

Historical multi-date compare vs Yahoo/EODHD: **Not Verified this run.**

---

## 13–18. Quality / freshness / license / cost

| | Hist depth | Adjust | Fund | Freshness | Reliability | Cost (stated 22 Aug 2026) | License |
|---|---|---|---|---|---|---|---|
| Mubasher | 5–25y daily **TESTED** | Unknown | Thin ratios **TESTED** | Last session **TESTED** | Unofficial scrape **TESTED** | Free | **Not verified** |
| Yahoo | N/A this run | N/A | Weak | 429 | Chart API fragile | Free unofficial | Yahoo ToS **not verified for redistribution** |
| EODHD | Docs 2000+/30y | Docs adjusted | Docs paid | Docs 15m live | Standard REST | $20–$100/mo | Paid commercial; **storage/AI not verified** |
| Twelve Data | Docs | Docs splits/div | Docs paid tiers | Docs; EGX delay “–” | REST | $0–$329/mo personal | **Non-commercial on individual** |
| ICE | Docs 15y ticks | Docs | Docs | Docs RT | Enterprise | Custom | Exchange/ICE contract |
| EGX official | Files if any | — | — | EOD | WAF | — | Exchange rules **not verified** |

---

## 19. Scorecard (only where evidence exists)

Weights: Coverage 20%, History 20%, Quality 20%, Freshness 10%, Fundamentals 10%, API 10%, Cost 5%, License 5%.

| Provider | Coverage | History | Quality | Fresh | Fund | API | Cost | License | Total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Mubasher** | 18 | 19 | 9 | 7 | 4 | 6 | 5 | 1 | **69** |
| Yahoo | N/A* | N/A | N/A | 2 (429) | N/A | 3 | 5 | 1 | **N/A** |
| EODHD | 12 docs | N/A | N/A | N/A | N/A | 8 docs | 3 | N/A | **N/A** |
| Twelve Data | 16 list | N/A | N/A | N/A | N/A | 7 list+401 | 4 | 2 personal | **N/A** |
| Others | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | **N/A** |

\*Yahoo coverage in-repo historically; **this benchmark did not obtain a single EGX bar.**

---

## 20. Final recommendation — Option E

Keep Mubasher in production **for now**. Do **not** promote Yahoo, EGXpilot, or EGXAPI. Do **not** switch to EODHD/Twelve until a **keyed same-day/same-date replay** vs Mubasher CSV exists.

Why not C as the *foundation*: Yahoo failed this test; a “secondary” that 429s is not a foundation. Why not D: no tested new primary.

---

## 21. Phase 2 architecture (describe only — not implemented)

```text
Mubasher adapter (current)     EODHD/Twelve adapters (after keyed trial)
Official EGX files (if licensed)
        ↓
Provider adapters → normalized EGX bars (ISIN + Reuters + .CA)
        ↓
Validation (last vs official close; change% recomputed; calendar)
        ↓
Append-only historical store (EOD snapshots, not 20s full-file overwrite)
        ↓
Analysis / AI / future portfolio
```

**Next investigation (still not production):** one EODHD key and/or Twelve Data key; compare COMI **EGS60121C018** / **COMI.EGX** vs Mubasher CSV on **2026-08-20, 2026-05-20, 2025-08-20**.
