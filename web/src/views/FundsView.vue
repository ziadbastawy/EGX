<script setup>
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "../composables/useI18n.js";
import { useMarketData } from "../composables/useMarketData.js";
import { analyzeUniverse } from "../../../src/lib/indicators.js";
import { scoreThndrFunds } from "../../../src/lib/thndrFunds.js";

const { lang, t, locale } = useI18n();
const { payload, results, loading, error } = useMarketData({ poll: true, pollMs: 30_000 });

const filter = ref("all");
const kinds = ["all", "equity", "savings", "gold", "sector", "balanced"];
const KIND_ORDER = ["equity", "sector", "balanced", "gold", "savings"];
const STANCE_ORDER = { invest: 0, hold: 1, take_profit: 2 };

const items = computed(() => {
  if (!results.value.length) return [];
  return scoreThndrFunds(analyzeUniverse(results.value));
});

const filtered = computed(() => {
  const list =
    filter.value === "all" ? [...items.value] : items.value.filter((f) => f.kind === filter.value);
  return list.sort((a, b) => {
    const s = (STANCE_ORDER[a.stance] ?? 9) - (STANCE_ORDER[b.stance] ?? 9);
    if (s) return s;
    return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.code.localeCompare(b.code);
  });
});

const counts = computed(() => {
  const map = { all: items.value.length };
  for (const f of items.value) map[f.kind] = (map[f.kind] || 0) + 1;
  return map;
});

function nameOf(f) {
  return lang.value === "ar" ? f.nameAr || f.nameEn : f.nameEn || f.nameAr;
}

function reasonOf(f) {
  return lang.value === "ar" ? f.reasonAr : f.reasonEn;
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale.value);
}
</script>

<template>
  <div class="funds-page">
    <RouterLink class="back" :to="{ name: 'home' }">{{ t.back }}</RouterLink>
    <header class="scalp-page-head">
      <h1>{{ t.fundsPageTitle }}</h1>
      <p>{{ t.fundsPageLede }}</p>
      <p v-if="payload.scrapedAt" class="funds-asof">{{ t.scraped }}: {{ fmtDateTime(payload.scrapedAt) }}</p>
    </header>

    <div class="funds-filters" role="tablist">
      <button
        v-for="k in kinds"
        :key="k"
        type="button"
        class="funds-filter"
        :class="{ active: filter === k }"
        @click="filter = k"
      >
        {{ k === "all" ? t.fundsAll : t.fundsKind[k] }}
        <span v-if="counts[k]" class="funds-count">{{ counts[k] }}</span>
      </button>
    </div>

    <p v-if="loading" class="empty">{{ t.loading }}</p>
    <p v-else-if="error" class="empty">{{ t.loadError }}: {{ error }}</p>
    <p v-else-if="!filtered.length" class="empty">{{ t.fundsEmpty }}</p>

    <div v-else class="funds-grid">
      <article
        v-for="f in filtered"
        :key="f.code"
        class="fund-card"
        :class="f.stance"
      >
        <div class="fund-card-top">
          <div class="sym">{{ f.code }}</div>
          <span class="badge fund-stance">{{ t.fundsStance[f.stance] }}</span>
        </div>
        <h2 class="fund-name">{{ nameOf(f) }}</h2>
        <div class="fund-meta">
          <span>{{ t.fundsKind[f.kind] }}</span>
          <span v-if="f.manager">{{ f.manager }}</span>
          <span v-if="f.sharia">{{ t.fundsSharia }}</span>
          <span v-if="f.product">{{ t.fundsProduct }}</span>
        </div>
        <p class="fund-reason">{{ reasonOf(f) }}</p>
      </article>
    </div>

    <p class="ai-disclaimer">{{ t.fundsDisclaimer }}</p>
  </div>
</template>
