<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "../composables/useI18n.js";
import { cardStats, sparkPaths } from "../lib/cardStats.js";

const props = defineProps({
  quote: { type: Object, required: true },
  lang: { type: String, default: "ar" },
  locale: { type: String, default: "ar-EG-u-nu-latn" },
  fundamentals: { type: Object, default: null },
});

const { t } = useI18n();

const router = useRouter();

const name = computed(() => {
  const q = props.quote || {};
  const ar = String(props.lang || "ar").startsWith("ar");
  const label = ar
    ? q.nameAr || q.name || q.nameEn
    : q.nameEn || q.name || q.nameAr;
  return String(label || "").trim() || shortTicker.value;
});

const up = computed(() => (props.quote.changePercent ?? 0) >= 0);

const shortTicker = computed(() => props.quote.ticker.replace(/\.CA$/i, ""));

function fmt(n, d = 2) {
  return Number(n).toLocaleString(props.locale, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function fmtBig(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const abs = Math.abs(Number(n));
  const suffix = props.lang === "ar"
    ? { b: " مليار", m: " مليون", k: " ألف" }
    : { b: "B", m: "M", k: "K" };
  if (abs >= 1e9) return `${fmt(Number(n) / 1e9, 2)}${suffix.b}`;
  if (abs >= 1e6) return `${fmt(Number(n) / 1e6, 2)}${suffix.m}`;
  if (abs >= 1e3) return `${fmt(Number(n) / 1e3, 1)}${suffix.k}`;
  return fmt(Number(n), 0);
}

function signed(n, d = 2) {
  return `${n >= 0 ? "+" : ""}${fmt(n, d)}`;
}

const f = computed(() => props.fundamentals?.fundamentals || null);
const summary = computed(() => props.fundamentals?.summary || null);

const s = computed(() => cardStats(props.quote));

const spark = computed(() => sparkPaths(s.value.closes));
const sparkUp = computed(() => (s.value.periodChangePct ?? 0) >= 0);
const gradId = computed(() => `spark-${shortTicker.value}`);

// Price position inside a low–high range, 0–100 for the marker.
function rangePos(low, high) {
  const p = props.quote.price;
  if (low == null || high == null || p == null) return null;
  if (high === low) return 50;
  return Math.min(100, Math.max(0, ((p - low) / (high - low)) * 100));
}
const dayPos = computed(() => rangePos(s.value.dayLow, s.value.dayHigh));
const periodPos = computed(() => rangePos(s.value.periodLow, s.value.periodHigh));

const turnover = computed(() => {
  if (summary.value?.turnover != null) return summary.value.turnover;
  const v = s.value.volume;
  return v && props.quote.price ? v * props.quote.price : null;
});

const trendLabel = computed(
  () => ({ up: t.value.cardTrendUp, down: t.value.cardTrendDown, sideways: t.value.cardTrendSide })[
    s.value.trend
  ]
);

const rsiZone = computed(() => {
  const r = s.value.rsi;
  if (r == null) return null;
  if (r >= 70) return { cls: "hot", label: t.value.cardOverbought };
  if (r <= 30) return { cls: "cold", label: t.value.cardOversold };
  return { cls: "", label: null };
});

function openDetails() {
  router.push({ name: "stock", params: { ticker: shortTicker.value } });
}
</script>

<template>
  <button type="button" class="stock" @click="openDetails">
    <div class="stock-head">
      <div class="stock-id">
        <span class="sym">{{ shortTicker }}</span>
        <span class="name" :title="name">{{ name }}</span>
      </div>
      <span class="chg-pill" :class="up ? 'up' : 'down'">
        <template v-if="quote.changePercent == null">—</template>
        <template v-else>{{ signed(quote.changePercent) }}%</template>
      </span>
    </div>

    <div class="stock-price-row">
      <div>
        <bdi dir="ltr" class="price-line">
          <span class="price">{{ fmt(quote.price) }}</span>
          <span class="cur">{{ quote.currency || "EGP" }}</span>
        </bdi>
        <div v-if="quote.change != null" class="chg" :class="up ? 'up' : 'down'">
          {{ signed(quote.change) }}
        </div>
      </div>
      <svg
        v-if="spark"
        class="spark"
        :class="sparkUp ? 'up' : 'down'"
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient :id="gradId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="currentColor" stop-opacity="0.22" />
            <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path :d="spark.area" :fill="`url(#${gradId})`" />
        <path :d="spark.line" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" />
      </svg>
    </div>

    <div class="ranges">
      <div v-if="dayPos != null" class="range">
        <span class="range-k">{{ t.cardDayRange }}</span>
        <div class="range-bar" dir="ltr">
          <span class="range-v">{{ fmt(s.dayLow) }}</span>
          <span class="range-track"><span class="range-dot" :style="{ left: `${dayPos}%` }" /></span>
          <span class="range-v">{{ fmt(s.dayHigh) }}</span>
        </div>
      </div>
      <div v-if="periodPos != null" class="range">
        <span class="range-k">{{ t.card3mRange }}</span>
        <div class="range-bar" dir="ltr">
          <span class="range-v">{{ fmt(s.periodLow) }}</span>
          <span class="range-track"><span class="range-dot" :style="{ left: `${periodPos}%` }" /></span>
          <span class="range-v">{{ fmt(s.periodHigh) }}</span>
        </div>
      </div>
    </div>

    <dl class="stock-stats">
      <div>
        <dt>{{ t.card3m }}</dt>
        <dd :class="s.periodChangePct == null ? '' : sparkUp ? 'up' : 'down'">
          <bdi dir="ltr">{{ s.periodChangePct == null ? "—" : `${signed(s.periodChangePct, 1)}%` }}</bdi>
        </dd>
      </div>
      <div>
        <dt>{{ t.cardVolume }}</dt>
        <dd>
          {{ fmtBig(s.volume) }}
          <small v-if="s.volRatio != null" :class="{ hi: s.volRatio >= 1.5 }">
            <bdi dir="ltr">×{{ fmt(s.volRatio, 1) }}</bdi>
          </small>
        </dd>
      </div>
      <div>
        <dt>{{ t.cardTurnover }}</dt>
        <dd>{{ fmtBig(turnover) }}</dd>
      </div>
      <div>
        <dt>P/E</dt>
        <dd>{{ f?.pe != null ? fmt(f.pe) : "—" }}</dd>
      </div>
      <div>
        <dt>P/B</dt>
        <dd>{{ f?.pb != null ? fmt(f.pb) : "—" }}</dd>
      </div>
      <div>
        <dt>{{ t.cardMarketCap }}</dt>
        <dd>{{ fmtBig(f?.marketCap) }}</dd>
      </div>
    </dl>

    <div class="signals">
      <span v-if="trendLabel" class="tag" :class="`trend-${s.trend}`">
        <span class="tag-dot" />{{ trendLabel }}
      </span>
      <span v-if="rsiZone" class="tag" :class="rsiZone.cls">
        RSI {{ fmt(s.rsi, 0) }}<template v-if="rsiZone.label"> · {{ rsiZone.label }}</template>
      </span>
    </div>
  </button>
</template>
