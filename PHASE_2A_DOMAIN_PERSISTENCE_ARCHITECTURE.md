# Phase 2A — Domain & Persistence Architecture (Proposal)

**Status:** Reviewable proposal only. Not an architectural decision.  
**Date:** 23 August 2026  
**Author role:** Research / architecture assistant (not system architect)  
**Production code:** not modified.  
**Evidence classes:** TESTED · DOCUMENTATION VERIFIED · INFERRED · PROPOSED · UNKNOWN  

This document proposes a logical persistence model for EGX market, corporate-action, validation, and AI-audit data. PostgreSQL + JSONB is a **preference under consideration**, not a chosen platform. MongoDB is evaluated against the **same** domain requirements. Phase 2 remains adapters / validation / architecture; treating history as research-grade or running backtests is **not** in scope.

**Section checklist (all required):** 1 Executive Summary · 2 Current System Architecture · 3 Current Persistence Model · 4 Domain Map · 5 Entity Classification · 6 Data Classification · 7 PostgreSQL+JSONB Evaluation · 8 MongoDB Comparison · 9 Proposed Logical Data Model · 10 Corporate Action Model · 11 Provider/Symbol Mapping · 12 AI Decision Snapshot · 13 Versioning · 14 Raw vs Normalized vs Adjusted · 15 MVP Persistence · 16 Future Persistence · 17 Migration Strategy · 18 Architecture Diagram · 19 Risks · 20 Open Questions · 21 Recommendation · 22 Explicit Decisions Required From Architect.

Prior evidence (cite, do not invent):

- `PHASE_1_75_DATA_VALIDATION_REPORT.txt` (22 Aug 2026)
- `docs/phase-1.5-provider-benchmark.md` (22 Aug 2026)
- Isolated integrity script: `research/benchmark/mubasher-integrity.mjs` / `research/benchmark/out/mubasher-integrity.json`

---

## 1. Executive Summary

The current system is a **Node scrape + Vue static JSON** app. Prices and candles live in `web/public/latest.json` (gitignored); fundamentals in `web/public/fundamentals.json` (not gitignored). The HTTP API (`src/server.js`) re-reads those files and **recomputes** technicals and AI prompts in memory. There is **no** database, **no** corporate-action table, **no** immutable AI audit log, and **no** EGX equity portfolio/order book. Client fund holdings live only in `localStorage` (`useMyFunds.js`) — **DOCUMENTATION VERIFIED**.

Phase 1.75 Phase-2 gate (**DOCUMENTATION VERIFIED**, do not weaken): **YES** for adapters/validation design only; **NO** for using this history as-is in indicators, scores, or backtests across corporate actions. Authenticated EODHD / Twelve Data were **NOT TESTED** (no credentials in environment — Phase 1.75 §2–3). Yahoo was **HTTP 429** in Phase 1.5; not a historical foundation.

Phase 1.75 **TESTED** that Mubasher daily CSVs are **not** split-back-adjusted at the documented COMI 1.1 split (effective 2025-12-17). The CSV has **no** `adjClose` / split / dividend flag. `analyzeQuote()` (`src/lib/indicators.js`) treats `quote.candles[].c` as one continuous series. Vendor `change` / `changePercentage` failed independent calc on **10/16** and **12/16** names (0.02 / 0.05-pt tolerances) — **TESTED**; `fetchMubasherQuote` still passes them through when present. Live last ≠ CSV close on **14/16** names — **TESTED**. Any persistence design that overwrites raw bars with adjusted prices would destroy the ability to audit the feed and to apply a later CA calendar.

**Proposal (not a decision):** keep a small number of **relational** identities (instrument, symbol mapping, corporate actions, trading calendar, version rows) and store **provider payloads, validation results, and AI snapshots** as **versioned JSON documents** (JSONB **if** PostgreSQL is chosen by the architect). Persist **raw OHLCV** separately from **derived adjusted series**. Do **not** persist portfolio/orders until product exists. Do **not** introduce warehouses, event buses, or Kubernetes. Do **not** treat PostgreSQL vs Mongo as a brand winner.

---

## 2. Current System Architecture

**DOCUMENTATION VERIFIED** from repo files.

| Layer | What exists | File / function |
|---|---|---|
| Universe | ~224 EGX names, Yahoo-style `TICKER.CA`; optional `yahoo` ISIN-style override | `data/symbols.js` `DEFAULT_SYMBOLS`; comment “224 سهم” |
| Config | `RANGE` (default `3mo`), `PRICE_SOURCE` (`mubasher` default), `KEEP_HISTORY`, `SYMBOLS` | `src/config.js` `getConfig()` |
| Price scrape | Batched quote fetch → JSON file | `src/scrape.js` `runScrape()` |
| Watch | Loop `runScrape` every `INTERVAL` (default 20s) | `src/watch.js` |
| Fundamentals scrape | HTML → `fundamentals.json` | `src/scrape-fundamentals.js` `runScrapeFundamentals()` / `pickFundamentals()` |
| Price providers | Mubasher JSON + CSV; Yahoo chart | `src/lib/mubasherQuote.js` `fetchMubasherQuote`; `src/lib/yahoo.js` `fetchQuote` |
| Fundamentals provider | Mubasher HTML | `src/lib/mubasher.js` `fetchMubasherStock`, `mubasherCode()` |
| File write | Dual write `output/` + `web/public/` | `src/lib/storage.js` `saveResults()` |
| Boot ensure | If `latest.json` missing/empty, background scrape | `src/lib/ensureMarketData.js` |
| API | Node `http` server, port env | `src/server.js` |
| UI | Vue 3; polls static JSON | `web/src/composables/useMarketData.js`, `useFundamentals.js` |
| Scoring | In-process, not stored | `src/lib/indicators.js` `analyzeQuote` / `analyzeUniverse` |
| “Depth” | Volume-at-price from daily candles, **not** L2 | `src/lib/priceDepth.js` `buildPriceDepth` |
| Sector | Name regex heuristics | `src/lib/companyContext.js` `inferSector` |
| Tests | **None found** (`*.test.js` / `*.spec.js` glob = 0) | UNKNOWN if informal scripts exist outside that pattern |

**Package:** `package.json` — Node ≥22.13, Vue, Vite, cheerio, `@cursor/sdk`. **No** PostgreSQL, MongoDB, ORM, or test runner **DOCUMENTATION VERIFIED**.

### 2.1 Current-state data flow (provider → module → transform → storage → consumer)

```
Mubasher quote API
  GET .../markets/EGX/stocks/{code}
        │
        ▼
  fetchMubasherQuote (mubasherQuote.js)
        │ parse priceBar; load CSV historicalFileUrl
        │ parseCsvCandles (date, o,h,l,c,v)  — NO adjClose
        │ overwrite last bar with live last (bar.value) if Cairo day == today
        │ pass through bar.change / changePercentage when present
        ▼
  runScrape (scrape.js)  →  payload { scrapedAt, range, priceSource, results[], errors[] }
        │
        ▼
  saveResults (storage.js)
        ├─ output/latest.json
        └─ web/public/latest.json   [gitignored]
        └─ output/prices-{Date.now()}.json  ONLY if KEEP_HISTORY=1

Yahoo (PRICE_SOURCE=yahoo | auto fallback)
  fetchQuote (yahoo.js) chart v8  interval=1d
        │ candles from quote[]  — no adjclose field used
        ▼
  same scrape → same latest.json

Mubasher HTML
  fetchMubasherStock (mubasher.js)
        │ FUNDAMENTAL_KEYS / SUMMARY_KEYS label map
        ▼
  runScrapeFundamentals → output/ + web/public/fundamentals.json  [overwrite, no KEEP_HISTORY]

Consumers of latest.json
  • Vue useMarketData  GET {BASE}latest.json
  • server loadMarket()  readFile LATEST_PATH
        ├─ GET /api/analyze  → analyzeUniverse
        ├─ GET /api/scan     → scanAnalyses + attachFundamentals
        ├─ GET /api/depth    → buildPriceDepth
        ├─ GET /api/funds    → scoreThndrFunds
        ├─ POST /api/suggest | suggest-scalp | /api/ask  → LLM, result not persisted
        └─ GET /api/company  → live HTML +  in-memory mubasherCache (TTL)

Consumers of fundamentals.json
  • Vue useFundamentals
  • server loadFundamentalsMap (5 min in-memory cache)
```

**INFERRED technical debt for any DB migration**

1. **Identity is Yahoo ticker** (`COMI.CA`) everywhere; Mubasher strips `.CA`; Twelve Data uses ISIN (`EGS60121C018`); EODHD docs use `COMI.EGX` — Phase 1.5/1.75 tables. 17 symbols have extra `yahoo:` ISIN-like codes in `data/symbols.js` (count **TESTED** via grep `yahoo:` = 17).
2. **Last candle is mutated** with live last (`fetchMubasherQuote`), so stored `c` ≠ CSV close (Phase 1.75 TESTED 14/16 names).
3. **Change fields are untrusted** but stored as-is when present (Phase 1.75 TESTED; `fetchMubasherQuote` lines ~179–190).
4. **RANGE filters history at ingest**; full CSV is discarded except in-memory `candleCache` (TTL default 6h).
5. **`KEEP_HISTORY` stamps whole payloads**, not incremental bars — `output/` is gitignored.
6. **AI responses are ephemeral**; cannot answer “why did we decide this 6 months ago?”
7. **Sectors are regex**, not a GICS/EGX official map.
8. **No automated tests** around parse/adjust/identity.
9. **GitHub Pages + Render**: UI reads static files; API is a separate origin (`web/src/lib/api.js` `VITE_API_BASE` / `egx_api_base` localStorage). Dual serving model must remain if JSON files stay during dual-write.

---

## 3. Current Persistence Model

| Store | Contents | Lifetime | Evidence |
|---|---|---|---|
| `web/public/latest.json` | Full scrape: quotes + **embedded candle arrays** (range-truncated) | Overwritten each scrape | `storage.js`; **gitignored** `.gitignore` line `web/public/latest.json` |
| `output/latest.json` | Same | Overwritten | `storage.js`; `output/` gitignored |
| `output/prices-{ts}.json` | Snapshot copy | If `KEEP_HISTORY=1` | `getConfig` / `saveResults` **DOCUMENTATION VERIFIED**; default **off** |
| `web/public/fundamentals.json` | PE, EPS, PB, book, mkt cap, shares, capital, par, currency + session summary | Overwritten; **not** gitignored | `scrape-fundamentals.js`; Phase 1.5 stale vs prices |
| In-process `candleCache` | Mubasher CSV parse per code/day/range | Process RAM, TTL | `mubasherQuote.js` |
| In-process `mubasherCache` | `/api/company` HTML parse | TTL | `server.js` |
| `fundamentalsCache` | Map for scan attach | 5 min | `server.js` |
| `localStorage` `egx-my-funds-v1` | Thndr **fund** holdings (code, amount, pnlPct) | Browser | `web/src/composables/useMyFunds.js` **DOCUMENTATION VERIFIED** |
| `localStorage` `egx_api_base` | API origin override | Browser | `web/src/lib/api.js` |
| `localStorage` `egx_auth_session` | Static email/password session | Browser | `useAuth.js` — **not** a user table |
| `localStorage` `egx-ai-settings` | Cursor/OpenAI keys (XOR obfuscation), model | Browser | `useAiSettings.js` |
| `localStorage` `egx-lang` | UI language | Browser | `useI18n.js` |

**Portfolio / orders for EGX equities:** no `Position`, `Order`, or broker adapter **found**. Fund “portfolio” is localStorage only. `priceDepth.js` explicitly is not an order book.

**KEEP_HISTORY:** env flag only; does not version fundamentals; does not write a bar warehouse.

---

## 4. Domain Map

**Today’s real domain (VERIFIED in code):**

- **Listed equity instrument** identified by Reuters-like code + `.CA` Yahoo suffix.
- **Provider quote + daily OHLCV** (Mubasher primary; Yahoo fallback).
- **Thin fundamentals snapshot** (ratios, not statements).
- **Derived technical analysis** (EMA/RSI/MACD/ATR/score/trade levels) computed on demand.
- **Heuristic company profile** (sector from names).
- **LLM narratives** (ask / suggest / scalp / funds advice / photo extract) — not stored.
- **Thndr fund catalog scoring** (`thndrFunds.js`) using EGX tape, not live NAVs (`/api/funds` note **DOCUMENTATION VERIFIED**).
- **Browser-only fund holdings** and **browser-only “auth”**.

**Must add for Phase 2 integrity (from Phase 1.75 blocker, not optional polish):**

- **Corporate actions** (at least splits; bonuses/dividends/rights as types even if source UNKNOWN).
- **Provider ↔ symbol mapping** (COMI / COMI.CA / COMI.EGX / EGS60121C018).
- **Data snapshots + validation results** (OHLC validity, last vs close, change-field failures).
- **Raw vs adjusted series** without overwriting raw.
- **AI decision snapshots** if product claims auditability.

**Out of current product:** live L2 book, official trading calendar file, EGX30 membership (prompts mention the gap — `server.js` data-limits text), earnings calendar, official sector taxonomy, equity portfolio accounting.

---

## 5. Entity Classification

Legend: **REQUIRED NOW** = needed for adapters/validation/CA-safe series. **REQUIRED SOON** = needed before trustworthy indicators/AI audit. **FUTURE** = product later. **NOT CURRENTLY NEEDED** = do not auto-create tables.

| Entity | Class | Rationale |
|---|---|---|
| Instrument | REQUIRED NOW | Canonical EGX equity; universe today is `DEFAULT_SYMBOLS` |
| Symbol | REQUIRED NOW | Display/Reuters code vs Yahoo ticker vs ISIN |
| Exchange | REQUIRED NOW (tiny) | EGX only today; `yahoo.js` copies meta exchange name |
| Provider | REQUIRED NOW | mubasher / yahoo / (future eodhd, twelve) |
| Provider Symbol Mapping | REQUIRED NOW | Phase 1.5/1.75 mapping table |
| Trading Calendar | REQUIRED SOON | EGX Sun–Thu; 2021-08-20 Friday miss **TESTED**; holidays UNKNOWN |
| OHLCV Bar | REQUIRED NOW | Core tape; store **raw** |
| Quote | REQUIRED NOW | Live last, prev close, vendor change fields, `updatedAt` |
| Market Session | REQUIRED SOON | Session date vs scrape wall clock; Saturday scrape of Thursday tape |
| Data Snapshot | REQUIRED NOW | Replaces “whole latest.json” as unit of ingest |
| Data Validation Result | REQUIRED NOW | Phase 1.75 checks as first-class |
| Corporate Action | REQUIRED NOW | Blocker |
| Split | REQUIRED NOW | COMI 1.1 **DOCUMENTATION VERIFIED** + CSV **TESTED** unadjusted |
| Bonus | REQUIRED SOON | EGX-common; not in Mubasher CSV **TESTED** |
| Cash Dividend | REQUIRED SOON | Dividends UNKNOWN in CSV (Phase 1.75) |
| Rights | FUTURE | Not evidenced in app |
| Fundamental Snapshot | REQUIRED NOW | Already a file; needs as-of + source |
| Technical Indicator Snapshot | REQUIRED SOON | Optional persist of `analyzeQuote` output for audit; today computed live |
| Score | REQUIRED SOON | `analyzeQuote` score 0–100; version with formula |
| Score Component | FUTURE | Internals not exported as named components today |
| News | FUTURE | `pickFundamentals` **drops** news/announcements **DOCUMENTATION VERIFIED** |
| AI Analysis | REQUIRED SOON | `/api/suggest`, `/api/ask` text |
| Decision | REQUIRED SOON | Structured actionHint / suggestion JSON |
| Decision Snapshot | REQUIRED SOON | Immutable “why 6 months ago” |
| Model Version | REQUIRED SOON | OpenAI `gpt-4o-mini` default; Cursor `composer-2.5` default (`server.js` / `runAsk.js`) |
| Prompt Version | REQUIRED SOON | Prompts inlined in `server.js` / `runAsk.js` — no id today |
| Input Context Snapshot | REQUIRED SOON | Quote + candles summary + fundamentals JSON stuffed into prompts |
| Portfolio | NOT CURRENTLY NEEDED | No equity portfolio entity |
| Position | NOT CURRENTLY NEEDED | Funds list ≠ equity position |
| Order | NOT CURRENTLY NEEDED | No orders |
| Execution | NOT CURRENTLY NEEDED | |
| Transaction | NOT CURRENTLY NEEDED | |
| Cash Balance | NOT CURRENTLY NEEDED | |
| Portfolio Valuation | NOT CURRENTLY NEEDED | |
| Performance Snapshot | NOT CURRENTLY NEEDED | |
| Benchmark | FUTURE | EGX30 not in Mubasher stock API (Phase 1.5) |
| Backtest Run | NOT CURRENTLY NEEDED | Phase 4 not approved; history not research-grade |

---

## 6. Data Classification

| Data | Classification | Notes |
|---|---|---|
| Instrument / symbol / mapping / CA / calendar | **Relational** | Identity, uniqueness, FK integrity |
| Provider registry | **Relational** | Small |
| Raw OHLCV + quote scalars | **Relational** (or partitioned table) | Query by instrument+session; do not bury only in JSON |
| Vendor `change` / `changePercentage` | **Relational nullable** + **raw payload** | Untrusted (Phase 1.75) |
| Full Mubasher quote JSON / CSV text | **Raw payload** | Provenance; license UNKNOWN |
| Yahoo chart JSON | **Raw payload** | |
| Fundamentals object | **JSONB** + extracted numeric columns for PE/EPS | Sparse, label-driven |
| Validation diagnostics | **JSONB** + pass/fail columns | |
| Adjusted OHLCV | **Relational derived**, `adjustment_method_id` | Never overwrite raw |
| Indicators / scores | **Derived**; persist as snapshot **JSONB** if audited | Recompute from chosen series |
| Sector profile | **Derived / cache**; optional JSONB | Regex today |
| Price depth | **Derived / not persisted** (cheap from bars) | |
| `candleCache` / HTTP caches | **Cache** | |
| AI prompt + completion + hashes | **JSONB** + relational version FKs | Immutable rows |
| latest.json as file | **Migration source / optional dual-write cache** | Not a warehouse |
| localStorage funds/auth/keys | **Not persisted server-side** (PROPOSED keep client) | Keys must not go to DB |
| If architect does **not** choose PostgreSQL | Same logical classes apply | “JSONB” = document column/collection equivalent — **PROPOSED** wording only |
| News | **Not persisted** (dropped at scrape) | |

---

## 7. PostgreSQL + JSONB Evaluation (fit for this project)

**Fit factors for THIS domain (not a brand contest):**

| Requirement | PG + JSONB fit | Class |
|---|---|---|
| Canonical instrument + multi-provider symbols | Strong: unique constraints, FKs | PROPOSED |
| Daily bars ~224 names × ~25y × ~250 sessions ≈ low millions of rows | Well within PG | INFERRED scale |
| Corporate actions as events applied to series | Strong: typed rows + effective dates | PROPOSED |
| “Do not overwrite raw” | Strong: separate tables + CHECK / permissions | PROPOSED |
| Heterogeneous vendor payloads | JSONB for raw; GIN optional | PROPOSED |
| Validation result trees | JSONB | PROPOSED |
| AI snapshots (prompt, context, output) | JSONB + TOAST | PROPOSED |
| Time-series analytics / warehouses | Not needed for MVP | |
| Ops today | **No PG in repo**; hosting on Render + static Pages — ops cost UNKNOWN | UNKNOWN |
| JSON-only access pattern of current Vue | Need either SQL API or keep exporting `latest.json` | PROPOSED dual-write |

**This project’s mix (not generic “SQL vs NoSQL”):** ~224 instruments, daily bars, sparse fundamentals, fat vendor JSON, CA events, validation trees, optional AI prompt blobs. Volume is small (**INFERRED** low millions of bars if full CSV is stored). The hard requirement is **referential integrity + never overwrite raw**, not horizontal scale.

**What JSONB would actually hold here:** Mubasher quote JSON, CSV text or parse diagnostics, fundamentals leftover fields, validation `payload`, AI `prompt_text` / `output_json`. Typed money/OHLC stay columns so CA joins and uniqueness are not buried in documents.

**Verdict (proposal, pending §22):** PostgreSQL + JSONB is a **good fit** if the architect wants one engine for identity, CA, bars, and documents. It is **not** justified by current traffic or microservices. It **is** justified by CA integrity, mappings, and audit — which JSON files cannot do. **Not approved until the architect chooses a store.**

---

## 8. MongoDB Comparison (same requirements)

| Requirement | MongoDB | PG + JSONB |
|---|---|---|
| Instrument uniqueness + mapping integrity | App-enforced or partial unique indexes; easier to get duplicate identities | Native FKs |
| Corporate actions + “never overwrite raw” | Possible with separate collections + discipline | Clearer relational invariant |
| Raw vendor documents | Natural | JSONB equivalent |
| Point-in-time AI snapshots | Natural documents | JSONB equivalent |
| Bar queries by date range | Fine with compound indexes | Fine; SQL aggregations familiar |
| Adjusted vs raw series | Two collections or `series_kind` field | Two tables or `series_kind` + FK to method |
| Current team/repo | Neither exists | Neither exists |
| Vue file pipeline | Either needs an export job | Same |

**Verdict (proposal, pending §22):** MongoDB is a **reasonable document store** for payloads and AI snapshots, but **weaker as the system of record for symbol identity and CA application** unless the team invests in equivalent uniqueness and referential rules. For this domain (EGX identity + splits + audit), a relational core is the safer default **if** a database is approved. Choosing Mongo “because JSON” duplicates JSONB without solving CA. **Not a winner-by-brand.**

---

## 9. Proposed Logical Data Model

Fields marked **VERIFIED** exist in current payloads/code. **PROPOSED** are new.

### 9.1 `exchange`

- `id`, `code` **VERIFIED** usage `"EGX"` in `mubasherQuote.js`
- `name`, `timezone` **PROPOSED** (`Africa/Cairo` used in `dayKeyCairo`)

### 9.2 `instrument`

- `id` **PROPOSED** UUID/serial
- `reuters_code` **VERIFIED** (e.g. `COMI` via `mubasherCode`)
- `name_ar`, `name_en` **VERIFIED** `data/symbols.js`
- `listing_status` **PROPOSED** (active only today; delisted UNKNOWN Phase 1.75 §11)
- `isin` **PROPOSED** (Twelve Data **DOCUMENTATION VERIFIED** for COMI `EGS60121C018`; not in `DEFAULT_SYMBOLS` except some `yahoo:` overrides)

### 9.3 `symbol`

- `instrument_id` FK
- `symbol` **VERIFIED** `COMI.CA`
- `scheme` **PROPOSED** (`yahoo_ca`, `reuters`, `isin`)
- `is_primary` **PROPOSED**

### 9.4 `provider` / `provider_symbol_mapping`

See §11. EODHD / Twelve mapping **rows may be seeded from docs/lists** with `verification_class=DOCS` or `LIST_TESTED`; **live OHLCV from those vendors is NOT TESTED** (no keys). Do not ingest them as production bars in Phase 2.

### 9.4b `trading_calendar` / `market_session` (thin today; REQUIRED SOON)

**PROPOSED** `trading_calendar`: `session_date`, `is_open`, `reason` (`weekday_closed` Fri/Sat **DOCUMENTATION VERIFIED** EGX week; holidays **UNKNOWN**).  
**PROPOSED** `market_session`: `session_date`, `scraped_at` (wall clock may be Saturday while tape is Thursday — Phase 1.5 **TESTED**).

### 9.5 `data_snapshot`

- `id`, `scraped_at` **VERIFIED** `payload.scrapedAt`
- `range` **VERIFIED** `cfg.range`
- `price_source` **VERIFIED** `payload.priceSource`
- `watch_interval_sec` **VERIFIED**
- `error_count` **VERIFIED** `payload.errors`
- `raw_manifest` JSONB **PROPOSED** (file hash, row counts)

### 9.6 `quote` (session / as-of)

- `instrument_id`, `snapshot_id`, `provider_id`
- `ticker` **VERIFIED**
- `price` / last **VERIFIED** (`quote.price`; Mubasher = live last after overwrite)
- `previous_close` **VERIFIED** (`bar.close` semantics **DOCUMENTATION VERIFIED** in code comment)
- `change`, `change_percent` **VERIFIED** (untrusted)
- `currency` **VERIFIED** (`EGP` hard-coded Mubasher; Yahoo `meta.currency`)
- `as_of` **VERIFIED** (`bar.updatedAt` parse +02:00)
- `source` **VERIFIED** `"mubasher"` / `"yahoo-finance-chart"` / `*-fallback`

### 9.7 `ohlcv_bar` (RAW)

- `instrument_id`, `provider_id`, `session_date` (Cairo date)
- `open, high, low, close, volume` **VERIFIED** CSV / Yahoo candles
- `source_kind` **PROPOSED** `csv` | `live_overlay` | `yahoo_chart`
- `is_live_overlay` **PROPOSED** (true when last bar replaced — **DOCUMENTATION VERIFIED** behaviour)
- Unique `(instrument_id, provider_id, session_date, source_kind)` **PROPOSED**

**No `adj_close` on this table** (Mubasher CSV has none — Phase 1.75 **TESTED**).

### 9.8 `ohlcv_bar_adjusted` (DERIVED)

- Same OHLCV + `adjustment_run_id`, `method` **PROPOSED**
- Built only after CA table populated

### 9.9 `corporate_action` / `split` / …

See §10.

### 9.10 `fundamental_snapshot`

- `instrument_id`, `scraped_at` **VERIFIED**
- `pe, eps, pb, book_value, market_cap, shares, capital, par_value, currency` **VERIFIED** keys in `mubasher.js` `FUNDAMENTAL_KEYS`
- `summary` JSONB **VERIFIED** `SUMMARY_KEYS`
- `period_type` **UNKNOWN** (TTM vs annual — Phase 1.75)
- `source_url` **VERIFIED** `data.url`

### 9.11 `data_validation_result`

- `snapshot_id` or bar FK
- `check_code` **PROPOSED** (`ohlc_invalid`, `last_ne_csv_close`, `change_mismatch`, `duplicate_date`, `jump_25pct`, `ca_unadjusted`)
- `severity`, `payload` JSONB

### 9.12 Version + AI tables

See §12–13. Logical names: `model_version`, `prompt_version`, `score_version`, `input_context_snapshot`, `decision_snapshot`, optional `ai_analysis` (narrative) as JSONB on the snapshot rather than a second mutable table.

### 9.13 Intentionally omitted from MVP schema

Portfolio, orders, executions, cash, backtest_run, news, EGX30 benchmark series.

---

## 10. Corporate Action Model (raw vs adjusted, provenance)

**Facts (do not weaken):**

- Mubasher CSV: no adjClose, no split ratio, no dividend field — Phase 1.75 **TESTED**.
- COMI forward split **1.1**, effective **2025-12-17** — **DOCUMENTATION VERIFIED** (stockanalysis.com / Investing.com per Phase 1.75).
- CSV 2025-12-16 C **117.5** → 2025-12-17 O **106.82** ≈ 117.5/1.1 — **TESTED**; pre-split closes remain on old scale.
- Dividends: **UNKNOWN**.
- Full CA calendar for 16 names: **UNKNOWN**.
- Spike-revert 2008–2010: **TESTED** pattern; cause **UNKNOWN** (do not auto-label as split).

**PROPOSED model**

```
corporate_action
  id
  instrument_id
  type            -- split | bonus | cash_dividend | rights | unknown_discontinuity
  ex_date         -- session date EGX
  record_date, pay_date     -- nullable UNKNOWN
  ratio_num, ratio_den      -- split 11/10 for 1.1  PROPOSED encoding
  cash_amount, currency     -- dividends
  source                    -- vendor | manual | research
  source_url / citation
  confidence                -- verified | inferred | disputed
  notes

adjustment_run
  id, created_at
  method_version            -- e.g. split_backadjust_v1
  ca_set_hash               -- which CA rows included
  notes                     -- "do not use for backtest until dividends known"

ohlcv_bar_adjusted
  bar aligned to raw by (instrument, session_date)
  adjustment_run_id
  -- NEVER UPDATE ohlcv_bar
```

**Rules (PROPOSED)**

1. Ingest stores **CSV close** and **live last** as distinct facts when they differ.
2. Indicators that need split-continuity consume **adjusted** series only after an `adjustment_run` whose method is versioned.
3. Until dividends are known, mark adjusted series `quality = incomplete_ca`.
4. Unknown jumps get `unknown_discontinuity` candidates, not silent price rewrites.
5. Phase 2 does **not** feed unadjusted long windows into “research-grade” scores (Phase 1.75 Phase 2 gate).

---

## 11. Provider / Symbol Mapping Model

Phase 1.5 / 1.75 **DOCUMENTATION VERIFIED** examples:

| Role | COMI example |
|---|---|
| EGX Reuters / Mubasher path | `COMI` |
| Repo / Yahoo convention | `COMI.CA` |
| EODHD (docs only, NOT TESTED) | `COMI.EGX` |
| Twelve Data list (Phase 1.5 TESTED list) | `EGS60121C018` |

**PROPOSED**

```
provider (id, code, kind)           -- mubasher, yahoo, eodhd, twelve_data
provider_symbol_mapping
  provider_id
  instrument_id
  provider_symbol                   -- COMI | COMI.CA | COMI.EGX | EGS60121C018
  market_code                       -- EGX
  valid_from, valid_to              -- ticker changes UNKNOWN
  verified_at, verification_class   -- TESTED | DOCS | INFERRED
  unique (provider_id, provider_symbol, valid_from)
```

`data/symbols.js` `yahoo:` field (17 names) is an **existing** second identifier — map as Yahoo fetch ticker **VERIFIED** in `yahoo.js` (`fetchTicker = yahoo || ticker`).

EGX30: **not** on Mubasher stock API — Phase 1.5. Mapping row may exist with `instrument_kind=index` **FUTURE**.

---

## 12. AI Decision Snapshot Model

**Today:** POST `/api/ask`, `/api/suggest`, `/api/suggest-scalp`, `/api/funds-advice`, `/api/funds-photo` return JSON and **do not write a store** (`server.js` **DOCUMENTATION VERIFIED**). Prompts are large string templates in `server.js` / `runAsk.js`. User keys stay in browser (`useAiSettings.js`).

**Requirement:** support “why did we decide this 6 months ago?”

**PROPOSED immutable snapshot** (insert-only; no UPDATE of body)

```
decision_snapshot
  id
  created_at
  endpoint                  -- suggest | suggest-scalp | ask | funds-advice | local-ask
  instrument_id             -- nullable for free-text ask
  lang
  provider_runtime          -- cursor | openai | local
  model_version_id          -- FK
  prompt_version_id         -- FK
  score_version_id          -- FK (analyzeQuote formula)
  input_context_snapshot_id -- FK
  output_json               -- parsed suggestion / answer  JSONB
  output_raw_text
  action_hint               -- if present
  user_id                   -- NOT present today; nullable
  -- omit API keys
```

```
input_context_snapshot
  id
  market_scraped_at         -- from latest.json
  range
  quote_json                -- price, previousClose, change* 
  candles_digest            -- hash + first/last dates + bar count; optional sample
  fundamentals_json         -- attached slice
  analysis_json             -- analyzeQuote output if included in prompt
  prompt_text               -- full prompt as sent (PII/keys stripped)
  prompt_sha256
```

**Immutability:** new row per call. Corrections = new snapshot with `supersedes_id`. Retention/privacy **UNKNOWN** (architect).

Local `/api/ask` `mode=local` should snapshot too (scanner fallback) so “decision” is not only LLM.

**Reconstructing “why did we decide this 6 months ago?” (PROPOSED query path)**

1. Find `decision_snapshot` by `instrument_id` + `created_at` window (or user question hash for `/api/ask`).
2. Join `prompt_version` (exact prompt text/hash) + `model_version` (provider + model id at call time) + `score_version` (git SHA of `analyzeQuote`).
3. Load `input_context_snapshot`: `market_scraped_at`, `range`, quote JSON **including untrusted vendor change fields labeled as such**, candle digest (not necessarily every bar), fundamentals slice, `analysis_json`.
4. Compare to **raw** bars/CA as of that `scraped_at` — if later CA rows were added, the old decision still points at the **then** context, not a rewritten history.
5. Do **not** require the LLM vendor to still host the same model; the snapshot is the audit record.

Without steps 2–4, a stored answer text alone cannot explain inputs or formula drift.

---

## 13. Versioning Strategy

| Artifact | Today | PROPOSED |
|---|---|---|
| Score formula | Unversioned `analyzeQuote` | `score_version` semver + git commit SHA |
| Score components | Implicit in code | Optional later |
| Prompts | Inline strings | `prompt_version` (`id`, `name`, `sha256`, `text`) |
| LLM models | Header `x-ai-model` / defaults `gpt-4o-mini`, `composer-2.5` | `model_version` (`provider`, `model_id`, captured at call) |
| Price provider | `priceSource` on scrape payload | `provider.version` + mapping `verified_at` |
| Adjustment method | N/A | `adjustment_run.method_version` |
| Symbol universe | `data/symbols.js` | `universe_version` or git SHA on snapshot |

Do not version by overwriting JSON files.

---

## 14. Raw vs Normalized vs Adjusted Data Strategy

| Layer | What | Consumers |
|---|---|---|
| **Raw** | Vendor numbers: CSV OHLCV; live last; vendor change fields; HTML fundamentals; full JSON/CSV blob | Validation, license audit, re-parse |
| **Normalized** | Canonical instrument_id, Cairo `session_date`, types, units EGP, mapping resolved, live vs CSV distinguished | Quotes UI (can keep showing last), APIs |
| **Adjusted** | Split (and later dividend) restated series | Indicators **after** CA policy approved — **not** Phase 2 scoring-as-truth |
| **Derived** | EMA/RSI/MACD/score/depth/sector | Compute from **declared** series_id |

**Never:** write adjusted close into the raw bar row.  
**Never:** drop CSV close because live last exists.  
**UI today** uses live last as `price` / last candle `c` — migrating UI to official close is an **architect product decision** (Phase 1.75 last vs close **UNKNOWN** semantics).

---

## 15. MVP Persistence Scope

**In (Phase 2 adapters/validation architecture):**

1. Instrument + symbol + provider mapping (seed from `data/symbols.js` + Phase 1.75 table).
2. Data snapshot + raw quotes + raw bars (CSV + overlay flag).
3. Corporate action table + seed COMI 1.1 2025-12-17 (cited).
4. Validation results for ingest (OHLC, last vs close, change mismatch, duplicates).
5. Fundamental snapshots as rows (from `fundamentals.json`).
6. Optional: keep writing `latest.json` for Vue (dual-write) so Pages still works.

**Out of MVP DB:**

- Equity portfolio/orders
- Backtest runs / marking history research-grade
- Computing or serving split-adjusted bars as the **only** series used by `analyzeQuote` (CA **storage** is in; **adjustment pipeline as truth** needs architect §22.3)
- Kubernetes, microservices, Kafka, warehouse
- News
- Full holiday calendar (stub timezone + weekday rule only if needed)
- Persisting user API keys
- Mongo + Postgres dual databases
- EODHD / Twelve Data production ingest (no keys; NOT TESTED)

**AI snapshots:** **REQUIRED SOON** but can ship immediately after ingest if “why 6 months ago” is a product requirement; otherwise second increment. Architect must choose (see §22).

---

## 16. Future Persistence Scope

- Dividend/bonus/rights completeness; official CA vendor
- Trading calendar + EGX30 constituents
- Indicator/score snapshot history
- Delisted / rename survivorship
- Authenticated EODHD / Twelve Data bars (NOT TESTED)
- User accounts (replace static `useAuth`)
- Equity portfolio if product appears
- Benchmark series
- Backtest run store **only after** CA + second vendor policy

---

## 17. Migration Strategy (JSON files → proposed store)

**PROPOSED**, not scheduled.

1. **Freeze semantics:** document that current `latest.json` last bar = live overlay.
2. **Seed identity** from `data/symbols.js` without deleting the file (file remains source until cutover).
3. **One-shot load** of current `latest.json` / `fundamentals.json` into snapshot + bars + fundamentals (lossy: only `RANGE` candles, not full CSV).
4. **Re-ingest full Mubasher CSV** (range=max) into raw bars — required for CA work; current files are insufficient depth for 25y.
5. **Dual-write (optional):** `saveResults` continues; a **new isolated adapter** (not production until approved) writes DB. Rollback = stop adapter, Vue still reads files.
6. **KEEP_HISTORY** stamps in `output/` remain archival; optional import, not system of record.
7. **Rollback:** gitignore + files unchanged; DB drop. No production `src/` change in this phase.
8. **Do not** migrate localStorage funds/auth/keys to server in MVP.

---

## 18. Architecture Diagram (ASCII)

```
                    +------------------+     +-------------------+
                    | Mubasher API/CSV |     | Yahoo chart (opt) |
                    +--------+---------+     +---------+---------+
                             |                         |
                             v                         v
                    +--------------------------------------------+
                    | Adapters (PROPOSED)                         |
                    |  map symbol → instrument                    |
                    |  raw payload store                          |
                    |  normalize quote + bars                     |
                    |  validate                                   |
                    +----------------+---------------------------+
                                     |
              +----------------------+----------------------+
              v                      v                      v
     +----------------+    +------------------+    +------------------+
     | RAW bars/quote |    | CA events        |    | fundamentals     |
     | + vendor JSON  |    | (split 1.1 …)    |    | snapshots        |
     +--------+-------+    +--------+---------+    +--------+---------+
              |                     |                       |
              |                     v                       |
              |            +------------------+             |
              |            | Adjusted series  |             |
              |            | (derived only)   |             |
              |            +--------+---------+             |
              |                     |                       |
              +----------+----------+-----------+-----------+
                         v                      v
              +--------------------+   +--------------------+
              | Validation results |   | File cache         |
              |                    |   | latest.json dual   |
              +--------------------+   +--------+-----------+
                                                |
                         +----------------------+------------------+
                         v                                         v
              +--------------------+                    +--------------------+
              | Vue (poll JSON)    |                    | API analyze/scan/AI|
              +--------------------+                    +--------+-----------+
                                                                 |
                                                                 v
                                                        +--------------------+
                                                        | Decision snapshots |
                                                        | (insert-only)      |
                                                        +--------------------+

NO (MVP): k8s, event bus, warehouse, portfolio ledger, EODHD/Twelve ingest, backtests
Adjusted series is DERIVED storage only — not approved as research-grade input
```

---

## 19. Risks

| Risk | Evidence | Impact |
|---|---|---|
| Unadjusted bars in indicators | Phase 1.75 blocker | Wrong EMA/RSI/MACD/score across splits |
| Last ≠ CSV close | TESTED 14/16 | Ambiguous “close” in DB and UI |
| Untrusted change% | TESTED 12/16 fail % | Bad AI/context if stored as truth |
| Invalid OHLC common | TESTED hundreds of flags / name | Garbage in, garbage out |
| Duplicate CSV dates | TESTED 4–5 / file | PK collisions if unique on date |
| No second vendor | EODHD/Twelve NOT TESTED | Mapping rows unverified in live OHLCV |
| License | Mubasher/Yahoo redistribution **not verified** | Legal UNKNOWN |
| Delistings | UNKNOWN | Survivorship |
| Dividends missing | UNKNOWN | Adjusted series incomplete |
| AI unaudited | No persistence | Cannot explain old calls |
| Static auth / keys in localStorage | Code | Security; do not copy keys to DB |
| Dual hosting Pages vs API | `api.js` | Split brain if DB is API-only |
| `KEEP_HISTORY` unused in prod | default off | No historical file trail |

---

## 20. Open Questions (do not invent answers)

1. Official vs last vs VWAP close for EGX EOD — Phase 1.75 **UNKNOWN**.
2. Complete CA calendar (splits, bonuses, cash dividends, rights) per listing — **UNKNOWN**.
3. EODHD / Twelve Data live OHLCV and adj_close — **NOT TESTED**.
4. Mubasher / Yahoo / Pages **license** for storing and serving history — **UNKNOWN**.
5. Should Vue keep file polling or move to API-only after a DB exists?
6. Must AI snapshots ship in the same MVP increment as bars?
7. Who is allowed to insert/edit corporate actions (manual vs vendor)?
8. Holiday calendar source for EGX?
9. Will equity portfolio/orders ever be in-product, or remain Thndr-funds-only?
10. Data retention and whether prompt text (may contain user questions) is stored?
11. ISIN coverage for all `DEFAULT_SYMBOLS` (not only Twelve list / 17 `yahoo:` rows)?
12. Render/hosting: is a managed PostgreSQL (or Mongo) acceptable operationally?
13. Timezone for bars: always `+02:00` (current parse) vs Africa/Cairo DST — **INFERRED** risk, not measured here.

---

## 21. Recommendation (proposal only, not a decision)

1. Treat **identity + corporate actions + raw bars + validation + (soon) AI snapshots** as the domain that JSON files cannot carry.
2. Prefer a **relational core with JSONB documents** **if** a database is approved — because mappings and CA application need constraints more than schemaless dumps. This is **fit for EGX integrity**, not a PostgreSQL marketing win.
3. Use Mongo only if the architect explicitly prefers document ops **and** accepts implementing identity/CA integrity in application code.
4. **MVP tables:** instrument, symbol, provider, mapping, snapshot, quote, raw ohlcv, corporate_action (seed COMI split), validation_result, fundamental_snapshot. Optional dual-write `latest.json`.
5. **Do not** persist portfolio/orders. **Do not** mark history research-grade. **Do not** overwrite raw with adjusted.
6. **Do not** implement production adapters, migrations, package installs, or PostgreSQL/Mongo in this Phase 2A work — architect approval first (§22).

---

## 22. Explicit Decisions Required From Architect

The following require **external approval**. This document does not decide them.

1. **Store technology:** PostgreSQL+JSONB vs MongoDB vs continue files-only vs other.
2. **Canonical close** for normalized quote and for indicator input: live last vs CSV close vs future official EOD.
3. **Whether adjusted series is computed in Phase 2** or only CA **storage** until dividends/second vendor exist.
4. **AI decision snapshots in MVP vs later**; retention and prompt storage policy.
5. **Dual-write latest.json** vs API-breaking change for Vue/GitHub Pages.
6. **Source of truth for universe:** keep `data/symbols.js` vs DB-first.
7. **Manual CA entry policy** vs wait for licensed vendor.
8. **Hosting/ops** for any database (who runs it; backup; secrets).
9. **License** go/no-go for persisting Mubasher CSV and Yahoo JSON.
10. **Indicator freeze:** stop using unadjusted `candles[].c` for windows that straddle known splits — product vs research messaging.
11. **Auth:** remain static localStorage or introduce users (out of Phase 2a persistence unless required).
12. **Scope exclusion confirmation:** no backtest schema, no k8s, no event bus.

---

*End of Phase 2A proposal. No production implementation accompanies this file.*
