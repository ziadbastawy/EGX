<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "../composables/useI18n.js";

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

const f = computed(() => props.fundamentals?.fundamentals || null);
const hasFundamentals = computed(
  () => f.value && (f.value.pe != null || f.value.eps != null || f.value.marketCap != null)
);

function openDetails() {
  router.push({ name: "stock", params: { ticker: shortTicker.value } });
}
</script>

<template>
  <button type="button" class="stock" @click="openDetails">
    <div class="sym">{{ shortTicker }}</div>
    <div class="name">{{ name }}</div>
    <div class="price">{{ fmt(quote.price) }} {{ quote.currency || "EGP" }}</div>
    <div class="chg" :class="up ? 'up' : 'down'">
      <template v-if="quote.change == null">—</template>
      <template v-else>
        {{ quote.change >= 0 ? "+" : "" }}{{ fmt(quote.change) }}
        ·
        {{ quote.changePercent >= 0 ? "+" : "" }}{{ fmt(quote.changePercent) }}%
      </template>
    </div>
    <!--
    <div v-if="hasFundamentals" class="fund">
      <span class="fund-item">
        <span class="fund-k">{{ t.fPe }}</span>
        <span class="fund-v">{{ f.pe != null ? fmt(f.pe) : "—" }}</span>
      </span>
      <span class="fund-item">
        <span class="fund-k">{{ t.fEps }}</span>
        <span class="fund-v">{{ f.eps != null ? fmt(f.eps) : "—" }}</span>
      </span>
      <span class="fund-item">
        <span class="fund-k">{{ t.fMarketCap }}</span>
        <span class="fund-v">{{ fmtBig(f.marketCap) }}</span>
      </span>
    </div>
    -->
  </button>
</template>
