-- Phase 2C schema from PHASE_2B_PERSISTENCE_ARCHITECTURE.md §B
-- Logical names, FKs, uniqueness, and JSONB boundaries implemented as specified.

CREATE TABLE instrument (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_ticker TEXT NOT NULL,
  name_ar TEXT,
  name_en TEXT,
  listing_status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT instrument_display_ticker_unique UNIQUE (display_ticker),
  CONSTRAINT instrument_listing_status_chk CHECK (listing_status IN ('active', 'delisted', 'unknown'))
);

CREATE TABLE provider (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  CONSTRAINT provider_code_unique UNIQUE (code)
);

CREATE TABLE provider_symbol_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id UUID NOT NULL REFERENCES instrument (id),
  provider_id UUID NOT NULL REFERENCES provider (id),
  provider_symbol TEXT NOT NULL,
  role TEXT NOT NULL,
  valid_from DATE NOT NULL,
  valid_to DATE,
  verification_class TEXT NOT NULL,
  notes TEXT,
  CONSTRAINT psm_provider_symbol_from_unique UNIQUE (provider_id, provider_symbol, valid_from),
  CONSTRAINT psm_role_chk CHECK (role IN ('fetch', 'fetch_alias', 'universe_ticker')),
  CONSTRAINT psm_verification_chk CHECK (
    verification_class IN ('TESTED', 'DOCS', 'INFERRED', 'SEED_FROM_FILE')
  )
);

CREATE INDEX psm_instrument_idx ON provider_symbol_mapping (instrument_id);

CREATE TABLE data_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scraped_at TIMESTAMPTZ NOT NULL,
  range TEXT NOT NULL,
  price_source TEXT NOT NULL,
  watch_interval_sec INTEGER,
  error_count INTEGER NOT NULL,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  universe_file_sha256 TEXT,
  hosting_context TEXT,
  payload_hash TEXT,
  raw_manifest JSONB
);

CREATE TABLE ohlcv_bar_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id UUID NOT NULL REFERENCES instrument (id),
  provider_id UUID NOT NULL REFERENCES provider (id),
  snapshot_id UUID REFERENCES data_snapshot (id),
  session_date DATE NOT NULL,
  observation_seq INTEGER NOT NULL,
  source_kind TEXT NOT NULL,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC,
  volume NUMERIC,
  source_timestamp_raw TEXT,
  tz_parse_rule TEXT NOT NULL,
  row_hash TEXT,
  CONSTRAINT ohlcv_raw_obs_unique UNIQUE (
    instrument_id, provider_id, source_kind, session_date, observation_seq
  ),
  CONSTRAINT ohlcv_raw_seq_chk CHECK (observation_seq >= 1),
  CONSTRAINT ohlcv_raw_source_kind_chk CHECK (source_kind IN ('csv', 'yahoo_chart'))
);

CREATE INDEX ohlcv_raw_instrument_date_idx ON ohlcv_bar_raw (instrument_id, session_date);
CREATE INDEX ohlcv_raw_snapshot_idx ON ohlcv_bar_raw (snapshot_id);

CREATE FUNCTION forbid_ohlcv_bar_raw_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ohlcv_bar_raw is insert-only; UPDATE is forbidden';
END;
$$;

CREATE TRIGGER ohlcv_bar_raw_no_update
  BEFORE UPDATE ON ohlcv_bar_raw
  FOR EACH ROW
  EXECUTE FUNCTION forbid_ohlcv_bar_raw_update();

CREATE TABLE quote_live (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id UUID NOT NULL REFERENCES instrument (id),
  snapshot_id UUID NOT NULL REFERENCES data_snapshot (id),
  provider_id UUID NOT NULL REFERENCES provider (id),
  ticker TEXT NOT NULL,
  last_price NUMERIC,
  previous_close_vendor NUMERIC,
  currency TEXT,
  as_of TIMESTAMPTZ,
  quote_source TEXT NOT NULL,
  cairo_day_at_scrape DATE,
  csv_last_session_date DATE,
  overlay_path TEXT,
  vendor_change NUMERIC,
  vendor_change_percentage NUMERIC,
  derived_change NUMERIC,
  derived_change_percentage NUMERIC,
  change_fields_trusted BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT quote_live_snapshot_inst_prov_unique UNIQUE (snapshot_id, instrument_id, provider_id),
  CONSTRAINT quote_live_overlay_path_chk CHECK (
    overlay_path IS NULL OR overlay_path IN ('replace_last', 'append_today', 'none')
  )
);

CREATE INDEX quote_live_instrument_idx ON quote_live (instrument_id);

CREATE TABLE data_validation_result (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID REFERENCES data_snapshot (id),
  instrument_id UUID REFERENCES instrument (id),
  ohlcv_bar_raw_id UUID REFERENCES ohlcv_bar_raw (id),
  quote_live_id UUID REFERENCES quote_live (id),
  check_code TEXT NOT NULL,
  severity TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  payload JSONB,
  CONSTRAINT dvr_severity_chk CHECK (severity IN ('info', 'warn', 'fail'))
);

CREATE INDEX dvr_snapshot_idx ON data_validation_result (snapshot_id);
CREATE INDEX dvr_instrument_idx ON data_validation_result (instrument_id);

CREATE TABLE fundamental_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id UUID NOT NULL REFERENCES instrument (id),
  scraped_at TIMESTAMPTZ NOT NULL,
  source_url TEXT,
  pe NUMERIC,
  eps NUMERIC,
  pb NUMERIC,
  book_value NUMERIC,
  market_cap NUMERIC,
  shares NUMERIC,
  capital NUMERIC,
  par_value NUMERIC,
  currency TEXT,
  period_type TEXT,
  summary JSONB,
  extra JSONB,
  source_provider TEXT NOT NULL,
  CONSTRAINT fund_snap_instrument_scraped_unique UNIQUE (instrument_id, scraped_at)
);

CREATE INDEX fund_snap_instrument_idx ON fundamental_snapshot (instrument_id);

-- Store-ready empty structure. Do not seed corporate-action rows in this increment.
CREATE TABLE corporate_action (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id UUID NOT NULL REFERENCES instrument (id),
  type TEXT NOT NULL,
  ex_date DATE NOT NULL,
  record_date DATE,
  pay_date DATE,
  ratio_num NUMERIC,
  ratio_den NUMERIC,
  cash_amount NUMERIC,
  currency TEXT,
  source TEXT NOT NULL,
  citation TEXT,
  confidence TEXT NOT NULL,
  notes TEXT,
  CONSTRAINT ca_type_chk CHECK (
    type IN ('split', 'bonus', 'cash_dividend', 'rights', 'unknown_discontinuity')
  ),
  CONSTRAINT ca_source_chk CHECK (source IN ('vendor', 'manual', 'research')),
  CONSTRAINT ca_confidence_chk CHECK (confidence IN ('verified', 'inferred', 'disputed'))
);

CREATE INDEX ca_instrument_idx ON corporate_action (instrument_id);
