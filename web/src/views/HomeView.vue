<script setup>
import { computed, ref } from "vue";
import AiAssistant from "../components/AiAssistant.vue";
import StockCard from "../components/StockCard.vue";
import { useI18n } from "../composables/useI18n.js";
import { useMarketData } from "../composables/useMarketData.js";
import { useFundamentals } from "../composables/useFundamentals.js";

const { lang, t, locale } = useI18n();
const { payload, results, loading, error } = useMarketData({
  poll: true,
  pollMs: 20_000,
});
const { get: getFundamentals, payload: fundPayload } = useFundamentals({
  poll: true,
  pollMs: 30_000,
});

const fundReady = computed(() => (fundPayload.value.results || []).length > 0);
const query = ref("");

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return results.value;
  return results.value.filter((s) => {
    const ticker = String(s.ticker || "").toLowerCase();
    const code = ticker.replace(/\.ca$/, "");
    return (
      ticker.includes(q) ||
      code.includes(q) ||
      String(s.nameAr || "").toLowerCase().includes(q) ||
      String(s.nameEn || "").toLowerCase().includes(q) ||
      String(s.name || "").toLowerCase().includes(q)
    );
  });
});

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale.value);
}
</script>

<template>
  <div>
    <div class="meta">
      <span>{{ t.scraped }}: {{ fmtDateTime(payload.scrapedAt) }}</span>
      <span>{{ results.length }} {{ t.stocks }}</span>
      <span>{{ t.range }}: {{ payload.range || "—" }}</span>
      <span class="live">Vue · {{ t.livePoll }}</span>
      <span v-if="payload.errors?.length" class="err">
        {{ t.failed }}: {{ payload.errors.length }}
      </span>
    </div>

    <div v-if="fundReady" class="assist-duo">
      <AiAssistant mode="local" :locale="locale" />
      <AiAssistant mode="ai" :locale="locale" />
    </div>
    <p v-else class="ai-home-wait">{{ t.aiWaitingData }}</p>

    <div v-if="results.length" class="stock-search">
      <input
        v-model="query"
        type="search"
        class="stock-search-input"
        :placeholder="t.searchPlaceholder"
        autocomplete="off"
      />
      <button v-if="query" type="button" class="stock-search-clear" @click="query = ''">
        {{ t.searchClear }}
      </button>
      <span class="stock-search-count">{{ filtered.length }} / {{ results.length }}</span>
    </div>

    <p v-if="loading" class="empty">{{ t.loading }}</p>
    <p v-else-if="error" class="empty">{{ t.loadError }}: {{ error }}</p>
    <p v-else-if="!results.length" class="empty">{{ t.empty }}</p>
    <p v-else-if="!filtered.length" class="empty">{{ t.searchNoResults }}</p>

    <div v-else class="grid">
      <StockCard
        v-for="(q, i) in filtered"
        :key="q.ticker"
        :quote="q"
        :lang="lang"
        :locale="locale"
        :fundamentals="getFundamentals(q.ticker)"
        :style="{ animationDelay: `${Math.min(i, 20) * 0.04}s` }"
      />
    </div>
  </div>
</template>
