# Phase 2B — Persistence Architecture (PostgreSQL + JSONB)

**Status:** Implementation architecture. Design-only. Not schema, migrations, or production code.  
**Date:** 23 August 2026  
**Store (decided):** PostgreSQL + JSONB. Do not reopen PostgreSQL vs Mongo vs files.  
**Depends on:** `PHASE_2A_DOMAIN_PERSISTENCE_ARCHITECTURE.md` (domain) and Phase 2A architecture validation (verified current state).  
**Evidence classes:** VERIFIED · INFERRED · UNKNOWN  

This document is the persistence contract for the first database increment. It does not invent repository APIs, SQL, or production adapters.

---

## A. Architecture Summary

Today the product persists **JSON files and browser localStorage**. There is **no database**. The listed-equity universe is `data/symbols.js` `DEFAULT_SYMBOLS` (**VERIFIED:** 224 names, ticker shape `COMI.CA`). Prices land in gitignored `output/latest.json` and `web/public/latest.json` via `src/lib/storage.js` (overwrite each scrape). Fundamentals overwrite committed `web/public/fundamentals.json` (as-of **2026-08-17**, count **221**). `KEEP_HISTORY` defaults off and stamps whole payloads when on. GitHub Pages scrape defaults to Mubasher or copies `web/public/market-snapshot.json`; Render build uses `PRICE_SOURCE=yahoo`. Those two tapes can already disagree.

JSON cannot carry: stable instrument identity, multi-provider mappings, ingest as a unit, raw bars before live overlay, live last vs historical close, untrusted vendor change vs calculated change, validation flags without deleting rows, fundamentals as-of, provenance, duplicate CSV observations, or future corporate-action events.

**Persistence architecture (this increment):** a **relational core** (identity, mappings, ingest snapshots, raw OHLCV, live quotes, vendor vs derived scalars, validation flags, fundamentals as-of, minimum provenance) plus **JSONB only** where the shape is provider-specific, sparse, or evolving. Canonical instrument identity is an **internal id**, never a provider ticker.

**Current overlay (VERIFIED, must not be the DB contract):** `fetchMubasherQuote` RANGE-filters at parse; if last CSV Cairo day === today, **REPLACE** last candle with live last; else **APPEND** a today-dated live bar. `latest.json` therefore can drop CSV close. The database stores **raw CSV (or Yahoo chart) bars unchanged** and **live quote as a separate fact**. Dual-write of `latest.json` keeps **today’s file schema** (including overlay mutation) so Vue/Pages do not change.

**Out of this increment’s persistence:** adjusted price series, exchange/calendar **tables** (weekday rule stays in existing `sessionDate.js`), AI product audit, overlay/indicator/Vue code changes, EODHD ingest, equity portfolio. Corporate-action **tables are designed** so a later increment can insert cited events without rewriting raw bars; this increment **does not persist CA rows** and **does not invent a CA dataset**.

**Universe SoT:** `data/symbols.js` remains the **current** universe source of truth until an explicit cutover. Whether the database later becomes universe SoT is **UNKNOWN**. Seed mappings from the file; do not delete the file.

---

## B. Entity Model

Logical names only. No SQL files. Field types are intent, not DDL.

### B.1 `instrument`

**Purpose:** One listed EGX equity (or future index — not in this increment). Internal stable identity. Provider tickers are **not** the PK.

| Field | Nullable | Notes |
|---|---|---|
| `id` | no | **PK.** UUID (preferred) or serial. Opaque. Never `COMI.CA`. |
| `display_ticker` | no | Display/convention ticker from `DEFAULT_SYMBOLS`, e.g. `COMI.CA`. **Not unique forever** (rename **UNKNOWN**). |
| `name_ar` | yes | From `symbols.js`. |
| `name_en` | yes | From `symbols.js`. |
| `listing_status` | no | Seed `active`. Delisted/rename survivorship **UNKNOWN**. |
| `created_at` | no | Seed/ingest time. |

**Uniqueness:** PK only for identity. `display_ticker` unique **while** the file is universe SoT (all 224 unique today — **VERIFIED** pattern). Do not put Mubasher code or Yahoo fetch ticker on this row as identity.

**JSONB:** none.

### B.2 `provider`

**Purpose:** Tiny registry of price/fundamentals sources. Not a vendor catalog product.

| Field | Nullable | Notes |
|---|---|---|
| `id` | no | **PK.** |
| `code` | no | Unique. Seed: `mubasher`, `yahoo`. Do **not** ingest EODHD/Twelve bars. Optional later rows `eodhd`, `twelve_data` with no OHLCV. |

**JSONB:** none.

### B.3 `provider_symbol_mapping`

**Purpose:** How this instrument is addressed at a provider. Multiple rows per instrument. This is where `COMI.CA`, Mubasher `COMI`, Yahoo fetch tickers, and aliases live.

| Field | Nullable | Notes |
|---|---|---|
| `id` | no | **PK.** |
| `instrument_id` | no | **FK** → `instrument.id` |
| `provider_id` | no | **FK** → `provider.id` |
| `provider_symbol` | no | Exact fetch/path string |
| `role` | no | See mapping roles below |
| `valid_from` | no | Date or timestamp; seed epoch/`1970-01-01` if unknown |
| `valid_to` | yes | Open-ended null = current |
| `verification_class` | no | `TESTED` \| `DOCS` \| `INFERRED` \| `SEED_FROM_FILE` |
| `notes` | yes | e.g. alias vs ISIN-style Yahoo override |

**Uniqueness:** (`provider_id`, `provider_symbol`, `valid_from`) unique so two instruments cannot share the same live provider code.

**JSONB:** none.

**Seed mapping roles (from VERIFIED repo behavior, not invented fetch logic):**

| Example | provider | provider_symbol | role |
|---|---|---|---|
| Universe / in-app ticker | `yahoo` (convention) or a synthetic `app` provider — **decision:** use provider `yahoo` with role `universe_ticker` **or** store universe ticker only on `instrument.display_ticker` plus a `yahoo` row when fetch ticker equals display. **Chosen:** `instrument.display_ticker` = `COMI.CA`; mapping rows as below. | | |
| Mubasher path | `mubasher` | `COMI` | `fetch` — `mubasherCode` strips `.CA` (**VERIFIED**) |
| Yahoo default fetch | `yahoo` | `COMI.CA` | `fetch` — `fetchTicker = yahoo \|\| ticker` (**VERIFIED**) |
| Yahoo override ISIN-style | `yahoo` | `EGS….CA` (15 of 17 `yahoo:` rows) | `fetch` — fetch ticker ≠ display ticker |
| Yahoo override **alias** | `yahoo` | `EKHO.CA` for `VLMR.CA`; `EKHOA.CA` for `VLMRA.CA` | `fetch_alias` — **not ISINs** (**VERIFIED**) |
| EODHD / Twelve | not seeded as live bars | `COMI.EGX` / `EGS60121C018` | **UNKNOWN** whether to insert `DOCS` mapping-only rows in increment 1. **Do not persist bars.** |

Do **not** treat `instrument.id` as any of these strings. Do **not** collapse VLMR and EKHO into one instrument unless product later proves they are the same listing — they are **separate universe rows** with Yahoo **fetch aliases** (**VERIFIED** as aliases, not as identity merge).

### B.4 `data_snapshot` (ingest unit)

**Purpose:** One scrape run. Replaces “overwrite whole `latest.json`” as the DB unit of ingest. Does **not** replace the file for Vue.

| Field | Nullable | Notes |
|---|---|---|
| `id` | no | **PK.** |
| `scraped_at` | no | Typed timestamptz. From payload `scrapedAt` (**VERIFIED**). |
| `range` | no | Typed text. Config `RANGE` (default `3mo`). |
| `price_source` | no | Typed text / FK-compatible code: `mubasher` \| `yahoo` \| `auto` as recorded on payload. |
| `watch_interval_sec` | yes | Typed int. Set only when watch passes it (**VERIFIED**); null for one-shot scrape. |
| `error_count` | no | Typed int. Length of payload `errors`. |
| `errors` | no | **JSONB** array. Per-symbol scrape failures; shape not a stable relational schema. |
| `universe_file_sha256` | yes | Provenance: hash of `symbols.js` content at seed/scrape if computed. Optional. |
| `hosting_context` | yes | Typed text. e.g. `pages` \| `render` \| `local` if known; else **UNKNOWN**/null. Documents split-brain, does not fix it. |
| `payload_hash` | yes | Hash of written `latest.json` bytes if dual-write happens later. |
| `raw_manifest` | yes | **JSONB.** License-gated: file hashes, row counts, CSV URL. Null if license forbids blobs (**license UNKNOWN**). |

**Uniqueness:** none required beyond PK. Many snapshots over time.

**Typed vs JSONB:** `scraped_at`, `range`, `price_source`, `watch_interval_sec`, `error_count` are **columns** (query, FK-adjacent, appear on every scrape). `errors` is JSONB (heterogeneous per-symbol objects). `raw_manifest` JSONB (optional evolving ingest metadata). Do not dump the entire `results[]` array into one JSONB document as the warehouse.

### B.5 `ohlcv_bar_raw`

**Purpose:** Historical OHLCV **before** overlay mutation. Source print as parsed: CSV row or Yahoo `quote[]` candle. **No `adjClose` column** (Mubasher CSV has none — **VERIFIED**). **Never UPDATE** OHLC after insert.

| Field | Nullable | Notes |
|---|---|---|
| `id` | no | **PK** (allows duplicate session dates). |
| `instrument_id` | no | **FK** |
| `provider_id` | no | **FK** |
| `snapshot_id` | yes | **FK** → `data_snapshot`. Null if backfill without snapshot — prefer set. |
| `session_date` | no | Cairo **calendar date** of the bar (date, not timestamptz). Key for “which session.” |
| `observation_seq` | no | Integer ≥ 1. Distinguishes duplicate CSV dates. Keep **all** raw observations. |
| `source_kind` | no | `csv` \| `yahoo_chart` only in this increment. **Not** `live_overlay`. |
| `open`, `high`, `low`, `close`, `volume` | yes | Parsed numbers; invalid OHLC **still stored**. |
| `source_timestamp_raw` | yes | Vendor date string / parsed instant as received. CSV parse uses `T00:00:00+02:00` (**VERIFIED**). |
| `tz_parse_rule` | no | e.g. `plus_02` documenting current parser. Africa/Cairo DST vs +02:00 is **UNKNOWN** / **INFERRED** risk. |
| `row_hash` | yes | Hash of source line for provenance. |

**Uniqueness:** (`instrument_id`, `provider_id`, `source_kind`, `session_date`, `observation_seq`). **Not** unique on session_date alone (**VERIFIED** CSV duplicate dates 4–5/file in research).

**JSONB:** none on the bar. Do not bury OHLCV in JSONB.

**Overlay:** do **not** insert a bar whose close was replaced by live last. Do **not** insert the appended “today-dated live bar” as `ohlcv_bar_raw`. Those belong on `quote_live`.

### B.6 `quote_live`

**Purpose:** Live / session quote facts **separate** from historical bars. One row per instrument per snapshot (latest scrape observation of last/prev/vendor change).

| Field | Nullable | Notes |
|---|---|---|
| `id` | no | **PK.** |
| `instrument_id` | no | **FK** |
| `snapshot_id` | no | **FK** |
| `provider_id` | no | **FK** |
| `ticker` | no | Display ticker as on result (**VERIFIED**). Not PK. |
| `last_price` | yes | Live last (`quote.price` / `bar.value` after current overlay — **VERIFIED**). |
| `previous_close_vendor` | yes | Mubasher `bar.close` is **previous close**; Yahoo `previousClose` is **prior candle** (**VERIFIED** — semantics differ by provider). |
| `currency` | yes | Mubasher hard-coded `EGP`; Yahoo `meta.currency`. |
| `as_of` | yes | `bar.updatedAt` parsed +02:00 (**VERIFIED**). |
| `quote_source` | no | `mubasher` \| `yahoo-finance-chart` \| `*-fallback` as on quote.source. |
| `cairo_day_at_scrape` | yes | `dayKeyCairo` “today” used for overlay decision. |
| `csv_last_session_date` | yes | Last CSV bar’s session_date **before** overlay. |
| `overlay_path` | yes | `replace_last` \| `append_today` \| `none` documenting what **production code did to the file**, not a DB mutation of raw bars. |
| `vendor_change` | yes | Untrusted. Pass-through if present. |
| `vendor_change_percentage` | yes | Untrusted. |
| `derived_change` | yes | Calculated last vs previous_close_vendor (or documented formula). Nullable if inputs missing. |
| `derived_change_percentage` | yes | Calculated. |
| `change_fields_trusted` | no | Boolean default false. True only if independent check passes (thresholds as Phase 1.75). |

**Uniqueness:** (`snapshot_id`, `instrument_id`, `provider_id`).

**JSONB:** none required. Optional later `vendor_quote_json` JSONB — **license UNKNOWN**; defer column until license go/no-go.

### B.7 `data_validation_result`

**Purpose:** Flag bad observations. **Do not delete** the raw bar or quote.

| Field | Nullable | Notes |
|---|---|---|
| `id` | no | **PK.** |
| `snapshot_id` | yes | **FK** |
| `instrument_id` | yes | **FK** |
| `ohlcv_bar_raw_id` | yes | **FK** when bar-scoped |
| `quote_live_id` | yes | **FK** when quote-scoped |
| `check_code` | no | See §F |
| `severity` | no | `info` \| `warn` \| `fail` |
| `passed` | no | Boolean |
| `payload` | yes | **JSONB** diagnostics (expected vs actual, row indexes). |

**Uniqueness:** none; multiple checks per bar.

### B.8 `fundamental_snapshot`

**Purpose:** Fundamentals **as-of scrape time**, not a property of the last price bar. File can be stale vs tape (**VERIFIED:** 2026-08-17 vs later prices; 221 vs 224 names).

| Field | Nullable | Notes |
|---|---|---|
| `id` | no | **PK.** |
| `instrument_id` | no | **FK** |
| `scraped_at` | no | Typed. From fundamentals payload. |
| `source_url` | yes | **VERIFIED** `data.url` when present. |
| `pe`, `eps`, `pb`, `book_value`, `market_cap`, `shares`, `capital`, `par_value` | yes | Extracted typed numerics from `FUNDAMENTAL_KEYS`. Negative PE allowed (exists in file). |
| `currency` | yes | |
| `period_type` | yes | **UNKNOWN** (TTM vs annual). Null until known. |
| `summary` | yes | **JSONB** `SUMMARY_KEYS` object. |
| `extra` | yes | **JSONB** other parsed fields that appear/disappear. |
| `source_provider` | no | `mubasher` for current HTML scrape. |

**Uniqueness:** (`instrument_id`, `scraped_at`) if one scrape per instrument per run; use snapshot-like grouping if a fundamentals ingest id is added later. First increment may use (`instrument_id`, `scraped_at`) unique.

News/announcements: dropped by `pickFundamentals` for the file; `/api/company` still fetches live news. **Do not persist news** in this increment.

### B.9 `corporate_action` (store-ready; **not populated** in first increment)

**Purpose:** Future CA events as **rows**, not bar patches. No adjusted series table in this increment. **Do not seed** COMI 1.1 here (that would be a dataset; citation lives in Phase 1.75 text). Integrity JSON **does not** contain COMI 2025-12-16/17 split rows (**VERIFIED**).

| Field | Nullable | Notes |
|---|---|---|
| `id` | no | **PK.** |
| `instrument_id` | no | **FK** |
| `type` | no | `split` \| `bonus` \| `cash_dividend` \| `rights` \| `unknown_discontinuity` |
| `ex_date` | no | EGX session date |
| `record_date`, `pay_date` | yes | **UNKNOWN** in current feeds |
| `ratio_num`, `ratio_den` | yes | Splits |
| `cash_amount`, `currency` | yes | Dividends |
| `source` | no | `vendor` \| `manual` \| `research` |
| `citation` | yes | URL/text |
| `confidence` | no | `verified` \| `inferred` \| `disputed` |
| `notes` | yes | |

**Uniqueness:** not required for empty table. Later: prevent duplicate cited events — **UNKNOWN** exact key until a CA source exists.

**JSONB:** none required.

**Explicitly absent:** `ohlcv_bar_adjusted`, `adjustment_run`. Architecture is ready to **add** them later without updating `ohlcv_bar_raw`.

### B.10 Intentionally not entities (first increment)

| Omitted | Why |
|---|---|
| `exchange` | EGX-only; constant, not a table (**validation**) |
| `trading_calendar` / `market_session` | Weekday rule in code; holidays **UNKNOWN** |
| `symbol` as a third identifier table | Overlaps mapping; `display_ticker` + `provider_symbol_mapping` suffice |
| AI `decision_snapshot` / version catalogs | Not product-persisted; Cursor `JsonlLocalAgentStore` is SDK-only (**VERIFIED**) |
| Scores / indicators | `analyzeQuote` uses `candles[].c` in memory; scores not stored |
| Portfolio / orders / users / API keys | localStorage; keys must not enter DB |
| EODHD/Twelve OHLCV | NOT TESTED; no keys |

---

## C. Relationship Model

```
instrument 1 ──< provider_symbol_mapping >── 1 provider
instrument 1 ──< ohlcv_bar_raw
instrument 1 ──< quote_live
instrument 1 ──< fundamental_snapshot
instrument 1 ──< corporate_action     (empty in increment 1)

data_snapshot 1 ──< quote_live
data_snapshot 1 ──< ohlcv_bar_raw     (optional FK)
data_snapshot 1 ──< data_validation_result

ohlcv_bar_raw 1 ──< data_validation_result
quote_live    1 ──< data_validation_result
```

**Cardinality notes**

- One instrument, many provider symbols (Mubasher `COMI`, Yahoo `COMI.CA` or `EGS….CA` or `EKHO.CA`).
- One snapshot, many quotes (universe scrape) and many raw bars (RANGE-truncated unless a later full-CSV ingest).
- One session_date, **many** raw bars via `observation_seq` (duplicates kept).
- Live last is **not** a child that overwrites the last raw bar.
- Fundamentals snapshots are **not** required to share `data_snapshot.id` with prices (separate scrape, different as-of). Optional later link is **UNKNOWN**.
- CA rows (later) reference `instrument` only; they do **not** FK-update bars.

**Identity graph (COMI / aliases)**

```
instrument.id = <uuid>          display_ticker = COMI.CA
  ├─ mapping mubasher / COMI / fetch
  └─ mapping yahoo / COMI.CA / fetch

instrument.id = <uuid>          display_ticker = VLMR.CA
  ├─ mapping mubasher / VLMR / fetch
  └─ mapping yahoo / EKHO.CA / fetch_alias     -- NOT an ISIN; NOT a merge with EKHO listing

instrument.id = <uuid>          display_ticker = VLMRA.CA
  └─ mapping yahoo / EKHOA.CA / fetch_alias
```

Whether `EKHO.CA` also exists as its own `DEFAULT_SYMBOLS` row is a file fact at seed time — **do not merge instruments** in architecture because Yahoo fetch strings collide. If seed finds two instruments sharing a Yahoo fetch ticker, that is a **validation flag** (`mapping_collision`), not silent collapse. **UNKNOWN** until seed is run; do not resolve now.

---

## D. Source-of-Truth Matrix

| Domain | Canonical Source | Vendor Fact | Derived Fact | Notes |
|---|---|---|---|---|
| Listed universe membership | `data/symbols.js` until cutover **UNKNOWN** | — | DB `instrument` seed | File remains SoT; DB is a replica until cutover |
| Instrument identity | `instrument.id` | — | — | Never provider ticker as ultimate PK |
| In-app / display ticker | `instrument.display_ticker` seeded from file | ticker on quote JSON | — | `COMI.CA` |
| Mubasher fetch code | `provider_symbol_mapping` | path `{code}` | strip `.CA` is **code behavior**, stored as mapping | Do not re-derive as PK |
| Yahoo fetch ticker | mapping `role=fetch` or `fetch_alias` | `yahoo:` override or ticker | `fetchTicker = yahoo \|\| ticker` | 15× `EGS….CA`; VLMR→EKHO aliases |
| Ingest run | `data_snapshot` | payload `scrapedAt`, `range`, `priceSource`, `errors` | `error_count` | Typed + JSONB errors |
| Historical OHLCV | `ohlcv_bar_raw` | CSV / Yahoo candle print | — | Pre-overlay; duplicates kept |
| Live last | `quote_live.last_price` | `bar.value` / chart last | — | Not written onto raw `close` |
| Previous close | `quote_live.previous_close_vendor` | Mubasher `bar.close`; Yahoo prior candle | — | Provider semantics **differ** |
| Session close for indicators | **UNKNOWN** | File uses overlaid `candles[].c` | — | Product close **UNKNOWN**; DB stores both last and raw close |
| Vendor change | `vendor_change*` | pass-through | — | Untrusted |
| Calculated change | `derived_change*` | — | last vs prev (or documented) | Distinguishable columns |
| Overlay mutation in **file** | production `fetchMubasherQuote` | — | replace vs append | Documented on quote `overlay_path`; **not** applied to DB raw |
| Validation | `data_validation_result` | — | checks vs raw/quote | Flag; do not delete |
| Fundamentals | `fundamental_snapshot` | HTML parse | — | As-of; not joined as same-session as last quote |
| Fundamentals file | `web/public/fundamentals.json` | scrape overwrite | — | Compatibility; DB does not replace file this increment |
| Price file UI | `latest.json` / Pages snapshot | scrape | overlay inside file | Schema **unchanged**; not DB SoT |
| Scores / technicals | not persisted | — | `analyzeQuote` in memory | Uses file candles today |
| AI answers | not product-persisted | SDK jsonl Cursor-only | — | Out of increment |
| Corporate actions | empty table / Phase 1.75 **text** for COMI 1.1 | CSV has **no** CA flags | — | No invented dataset; integrity JSON lacks split rows |
| Adjusted prices | none | none | none | Out of increment |
| License to store raw payloads | **UNKNOWN** | — | — | Blocks vendor JSON/CSV blob columns |

---

## E. JSONB Boundary Matrix

Every JSONB field in this architecture:

| Entity.field | Why JSONB | Why not a column | Indexing | Provider-specific / evolving |
|---|---|---|---|---|
| `data_snapshot.errors` | Array of per-symbol failure objects; keys vary | Would be an errors child table with unstable columns | Optional GIN if querying by ticker inside errors; **not required** for increment 1 | Yes — scrape error shapes |
| `data_snapshot.raw_manifest` | Optional hashes, URLs, counts | Sparse; license may force null | No | Yes |
| `data_validation_result.payload` | Check-specific diagnostics (indexes, expected/actual, duplicate partners) | Each `check_code` would need a different schema | No / optional GIN | Yes |
| `fundamental_snapshot.summary` | `SUMMARY_KEYS` bundle already a small object | Could be columns; summary set is label-driven | No | Somewhat stable today; keep JSONB |
| `fundamental_snapshot.extra` | Sparse leftovers; new HTML labels | Avoids ALTER per new Mubasher label | No | Yes |

**Not JSONB (relational columns):** instrument id, mappings, OHLCV numbers, live last, previous_close, vendor vs derived change, session_date, observation_seq, snapshot scraped_at/range/price_source/watch_interval_sec, extracted PE/EPS/PB/etc.

**Not a JSON dump of the relational model:** do not store `results[]` as one JSONB warehouse. Do not store candles only inside snapshot JSONB. JSONB is leftover/variable, not identity or tape.

**Deferred JSONB (license UNKNOWN):** full Mubasher quote JSON, CSV text, Yahoo chart body. Minimum provenance without blobs: `payload_hash`, `row_hash`, `source_url`, provider, `scraped_at`.

---

## F. Data Integrity Rules

1. **Raw bars are insert-only.** No UPDATE of OHLC. No split restatement in place. No live last written into `ohlcv_bar_raw.close`.
2. **Live quote is a different entity** from historical bars. Overlay replace/append is a **file** behavior; DB records `overlay_path` on `quote_live` and keeps CSV/Yahoo prints in `ohlcv_bar_raw`.
3. **Provider symbol ≠ instrument PK.** Mappings may change (`valid_from`/`valid_to`); history rows keep `instrument_id`.
4. **Duplicate raw observations are kept** (`observation_seq`). Do not first-wins/last-wins drop. Flag `duplicate_session_date`.
5. **Invalid OHLC is stored and flagged** (`ohlc_invalid`). Do not delete. Indicators must not treat flagged bars as clean **once** they read the DB (this increment does **not** change `analyzeQuote`).
6. **Vendor change fields are untrusted.** Store in `vendor_*`. Store calculated values in `derived_*`. Never copy vendor % into derived silently.
7. **Validation flags; never silent trust.** Persist results even when `passed=true` is optional; **must** persist failures.
8. **RANGE-filtered ingest is not 25y history.** First increment may persist only bars present in the scrape payload / parsed RANGE. Full CSV backfill is **later**. Current JSON files are insufficient as an archive.
9. **Fundamentals as-of** must not be treated as contemporaneous with `quote_live` without matching timestamps.
10. **Do not auto-label jumps as splits** (2008 spike-revert exists in integrity JSON; cause **UNKNOWN**). CA table stays empty until a cited source and policy exist.
11. **Do not persist adjusted series.** Incomplete CA (dividends **UNKNOWN**) would create false confidence.
12. **Do not persist API keys**, localStorage funds, or auth sessions.
13. **Cairo session_date** is the bar key. Scrape wall-clock may be Saturday; overlay may append a non-session day in the **file**. Flag `overlay_non_session_date` when `cairo_day_at_scrape` is not an EGX weekday (Sun–Thu). Official holidays **UNKNOWN**.
14. **Timezone:** store `tz_parse_rule`. DST vs fixed `+02:00` vs `Africa/Cairo` is **UNKNOWN** / **INFERRED** risk — do not “fix” in this architecture by rewriting dates.
15. **Pages vs Render** may produce two tapes (`price_source` / `hosting_context`). Both may be stored as separate snapshots. Convergence is **later**; not this increment.

### F.1 Validation `check_code` list (increment 1)

| check_code | Typical subject |
|---|---|
| `ohlc_invalid` | open/high/low/close relation (e.g. open > high) |
| `duplicate_session_date` | same instrument/provider/date, seq > 1 |
| `last_ne_csv_close` | live last ≠ last raw csv close |
| `vendor_change_mismatch` | vendor change vs derived (Phase 1.75 tolerances) |
| `vendor_change_pct_mismatch` | vendor % vs derived |
| `missing_vendor_change` | fields null; derived used in file — informational |
| `overlay_non_session_date` | append/replace using a non-weekday Cairo day |
| `range_truncated` | informational: not full CSV |
| `mapping_unresolved` | ticker in scrape not in mapping |
| `mapping_collision` | same provider_symbol → two instruments |
| `fundamental_name_unmatched` | in file universe but missing fundamentals (221 vs 224) |
| `invalid_date_parse` | if parser later validates; production CSV parse does **not** regex-validate today |

**Not in increment 1 as stored checks:** `ca_unadjusted` (no CA rows), `jump_25pct` as auto-CA. Optional later.

**No tests in repo** (**VERIFIED**). Research script `research/benchmark/mubasher-integrity.mjs` is not a production gate. Do not treat `mubasher-integrity.json` as containing the COMI 2025-12-16/17 split.

---

## G. Compatibility Strategy

### G.1 `latest.json` schema — do not change

Vue and Pages continue to read the **existing** scrape payload shape: `scrapedAt`, `range`, `priceSource`, `watchIntervalSec`, `results[]` (quotes **with embedded candles**, last bar possibly **overlaid**), `errors[]`. **No exporter is implemented in this phase.** When an exporter exists later, it must **reproduce overlay behavior** for the file so UI does not silently switch to CSV close.

### G.2 DB → JSON mapping (logical, not implemented)

| File field | DB source for a **future** exporter |
|---|---|
| `scrapedAt` | `data_snapshot.scraped_at` |
| `range` / `priceSource` / `watchIntervalSec` / `errors` | snapshot columns / JSONB |
| `results[].ticker` / names | instrument + quote |
| `results[].price` | `quote_live.last_price` |
| `results[].previousClose` | `quote_live.previous_close_vendor` |
| `results[].change` / `changePercentage` | **vendor** fields (file today passes vendor through) |
| `results[].candles` | **Cannot** be a 1:1 dump of `ohlcv_bar_raw` | Exporter would RANGE-filter raw bars then **apply the same replace/append overlay** using live last — that is file compatibility, not DB truth |

### G.3 What cannot fit in `latest.json`

- Internal `instrument.id`
- Provider mapping history / aliases / ISIN-style fetch tickers as first-class rows
- Duplicate CSV rows (file parse does not dedupe; last bar overlay still collapses the **last** session)
- Raw close **and** live last for the same session as two bars
- Validation flags
- Provenance hashes / snapshot identity
- Fundamentals as-of (separate file)
- CA events
- Multiple providers’ tapes for the same instrument in one document without changing schema

### G.4 Raw close vs live internally

| Consumer | Close meaning today | After DB exists (this increment) |
|---|---|---|
| `latest.json` / Vue / `analyzeQuote` | Overlaid last as `c` | **Unchanged** (no Vue/indicator/overlay code change) |
| `ohlcv_bar_raw.close` | N/A | Unmutated vendor historical close |
| `quote_live.last_price` | N/A | Live last |
| Canonical product EOD close | **UNKNOWN** | Still **UNKNOWN** |

### G.5 Pages / Render convergence

**Later.** Increment 1 may persist whatever scrape ran (`price_source` on snapshot). Do not change `render.yaml` or Pages workflow. Dual-write, if added later, must not pretend there is one tape.

`web/public/market-snapshot.json` is a committed Pages fallback (**VERIFIED**); it is not redesigned here.

---

## H. Migration Boundary (first increment)

### Will persist

- `instrument` + `provider` + `provider_symbol_mapping` **seeded from** `data/symbols.js` (file remains universe SoT; cutover **UNKNOWN**)
- `data_snapshot` (typed ingest fields + JSONB `errors`)
- `ohlcv_bar_raw` **pre-overlay** (from parsed CSV/Yahoo candles **before** replace/append)
- `quote_live` (last, vendor previous close, untrusted vendor change, derived change, overlay_path)
- `data_validation_result` (flags, not deletes)
- `fundamental_snapshot` as-of (extracted columns + JSONB summary/extra)
- Minimum provenance: snapshot time, provider, range, hashes/URLs where available **without** requiring raw payload blobs

### Will not persist

- Adjusted / restated OHLCV
- `corporate_action` **rows** (table may exist empty / deferred to next increment — **store-ready design only**; no invented CA dataset; no COMI seed from Phase 1.75 into DB this increment)
- Exchange / trading calendar **tables**
- AI audit / prompt/model/score version catalogs
- Scores, depth, sector
- EODHD / Twelve bars
- Portfolio, orders, users, API keys
- Full CSV beyond RANGE unless a later backfill job (not this increment’s required write path)
- Changes to overlay, indicators, or Vue
- Exporter DB → `latest.json`

### Will not change in production this increment

- `latest.json` schema or gitignore behavior
- `fundamentals.json` commit/overwrite behavior
- `fetchMubasherQuote` overlay
- `analyzeQuote` series choice

**Adapter behavior** (how a worker reads providers and inserts rows) is **not specified** here — do not invent repositories.

---

## I. Deferred Decisions (must NOT block initial persistence)

These remain open and **must not** block creating identity, snapshot, raw bars, live quotes, validation, fundamentals, provenance:

1. Canonical **product** close for UI/indicators (live last vs CSV close vs official EOD) — **UNKNOWN**.
2. Universe cutover: DB-first vs keep `symbols.js` forever — **UNKNOWN**; file stays SoT for now.
3. License go/no-go for storing full vendor JSON/CSV blobs — **UNKNOWN**; use hashes/URLs.
4. Whether to insert empty `corporate_action` table vs add it in increment 2 — schema timing only; **no CA data** either way this increment.
5. Manual CA editor vs licensed vendor — no rows.
6. AI snapshots / retention / prompt PII.
7. Official EGX holiday calendar.
8. ISIN coverage for all 224 names.
9. DST vs `+02:00` measurement and parser change.
10. Hosting/ops for managed PostgreSQL on Render — **UNKNOWN** operationally; does not block **logical** persistence design.
11. Pages/Render single-tape policy.
12. Import of `KEEP_HISTORY` `output/prices-*.json` stamps.
13. Delist/rename survivorship model.
14. Auth/users; equity portfolio.
15. Indicator freeze messaging once CA exists.

**Resolved enough to start persistence (from this document + user goals):** store = PostgreSQL+JSONB; internal instrument id; mappings; keep duplicate raw rows; live vs raw split; vendor vs derived columns; flag-not-delete; fundamentals as-of; JSONB only at documented boundary; latest.json schema frozen; CA store-ready without adjusted series; minimum provenance not event sourcing.

---

## J. Implementation Readiness

**Ready: NO**

Logical persistence is specified for increment 1, but **implementation must not start** until operational blockers below are accepted. The domain model is not the remaining gap; **hosting, license, and “who runs Postgres”** are.

### Blocking decisions (implementation, not model)

1. **License** to persist Mubasher/Yahoo **normalized numbers** (even without blobs) — **UNKNOWN**. If redistribution is forbidden, no DB of quotes.
2. **Hosting/ops:** managed PostgreSQL allowed for this project? `render.yaml` has no database today — **UNKNOWN**.
3. **Secrets/backup** for that database — **UNKNOWN**.
4. Explicit **go** to add packages/migrations (this document forbids doing that now).

Non-blocking for **writing** adapters later: canonical UI close, AI audit, CA dataset, calendar tables, Pages/Render merge.

### Files expected touched (later implementation — do not touch now)

- New: SQL migrations / schema (not created in this phase)
- New: persistence adapter modules under `src/` (not invented here)
- Possibly later: `src/scrape.js` / `src/lib/storage.js` dual-write **without** changing JSON schema
- Seed reader of `data/symbols.js` (file **remains**; may be read-only)

### Files that must remain untouched (this design phase and increment-1 product freeze)

- `src/lib/mubasherQuote.js` overlay behavior
- `src/lib/indicators.js` / Vue views/composables that consume `latest.json`
- `latest.json` schema (gitignored output)
- `web/public/fundamentals.json` schema
- `render.yaml` / Pages workflow (convergence later)
- `data/symbols.js` as universe SoT (seed only; no cutover)
- No `.sql` files in **this** Phase 2B drop

### Packages expected later (DO NOT add now)

- `pg` (or equivalent PostgreSQL client)
- Optional: migration runner (`node-pg-migrate`, `drizzle`, `knex`, etc.) — **not chosen**
- **Do not** add MongoDB drivers
- **Do not** add a test runner solely because this doc exists (tests remain absent — **VERIFIED**)

### Migration work later (not now)

- Create PostgreSQL database
- Apply schema for entities in §B (except empty CA may be increment 2)
- Seed instruments/mappings from `symbols.js`
- Ingest path: snapshot + raw bars pre-overlay + quote_live + validation + fundamentals
- Dual-write files unchanged
- Full CSV backfill: separate later job

---

## Design questions (1–12)

1. **Canonical instrument:** internal UUID (or serial) PK. `COMI.CA` is `display_ticker`. Mubasher `COMI` and Yahoo `COMI.CA` / `EGS….CA` / `EKHO.CA` aliases are `provider_symbol_mapping` rows. Aliases do not merge instruments.

2. **Ingest snapshot:** typed `scraped_at`, `range`, `price_source`, `watch_interval_sec`, `error_count`; JSONB `errors` (+ optional `raw_manifest`). Not one JSON dump of `results`.

3. **Raw bars:** vendor print before overlay; duplicates kept via `observation_seq`; `session_date` + `source_timestamp_raw` / `tz_parse_rule`. No live_overlay rows in raw table.

4. **Live quote:** `quote_live` separate. Overlay path recorded, not applied to raw.

5. **Vendor vs derived:** parallel columns; `change_fields_trusted`.

6. **Validation flags:** listed in §F.1; persist-and-flag.

7. **Fundamentals as-of:** row per scrape; extracted numerics + JSONB `summary`/`extra`; `period_type` UNKNOWN/null.

8. **JSONB:** only evolving/sparse/provider-shaped fields (§E). Not the relational model.

9. **CA:** entity designed; no adjusted prices; no CA dataset invented; integrity JSON is not the split source.

10. **latest.json:** coexist; schema frozen; exporter **not implemented**.

11. **SoT:** §D. File = universe until cutover UNKNOWN. Raw vendor print = historical OHLCV. Live last = quote. File ≠ DB truth for close.

12. **Provenance:** snapshot + provider + hashes/URLs + mapping `verification_class`. **Not** event sourcing (no event log, no replay engine).

---

FILES MODIFIED: only PHASE_2B_PERSISTENCE_ARCHITECTURE.md  
PACKAGES CHANGED: NONE  
PRODUCTION CODE CHANGED: NONE  
DATABASE CHANGED: NONE  
MIGRATIONS CREATED: NONE
