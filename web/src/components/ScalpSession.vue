<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "../composables/useI18n.js";
import { useAiSettings } from "../composables/useAiSettings.js";
import { apiUrl } from "../lib/api.js";
import { formatSessionDay, getNextEgxSessionDate } from "../lib/sessionDate.js";

const props = defineProps({
  locale: { type: String, default: "ar-EG-u-nu-latn" },
  mode: { type: String, default: "local" },
  horizon: { type: String, default: "session" },
  limit: { type: Number, default: 8 },
});

const { lang, t } = useI18n();
const { aiHeaders } = useAiSettings();
const router = useRouter();

const items = ref([]);
const loading = ref(false);
const error = ref(null);
const loadedOnce = ref(false);

const isLocal = computed(() => props.mode === "local");
const isWeek = computed(() => props.horizon === "week");
const scanType = computed(() => (isWeek.value ? "week" : "scalp"));
const sessionDay = computed(() => formatSessionDay(getNextEgxSessionDate(), props.locale));

const title = computed(() => {
  if (isWeek.value) return isLocal.value ? t.value.weekLocalTitle : t.value.weekAiTitle;
  return isLocal.value ? t.value.scalpLocalTitle : t.value.scalpAiTitle;
});

function planOf(item) {
  return isWeek.value ? item?.week : item?.scalp;
}

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  const d = v >= 10 ? 2 : v >= 1 ? 3 : 4;
  return v.toLocaleString(props.locale, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function tickerCode(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/\.CA$/i, "");
}

async function fetchScan() {
  const res = await fetch(apiUrl(`/api/scan?type=${scanType.value}&limit=${props.limit}`));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return (data.items || []).filter((row) => planOf(row)?.eligible);
}

async function loadLocal() {
  items.value = await fetchScan();
}

async function loadAi() {
  const localItems = await fetchScan();
  const byCode = new Map(localItems.map((row) => [tickerCode(row.ticker), row]));
  const listed = localItems
    .map((row) => {
      const p = planOf(row);
      return `${tickerCode(row.ticker)} buy=${p?.buy} sell=${p?.sell}`;
    })
    .join(", ");

  const question = isWeek.value
    ? t.value.weekAiQuestion(props.limit, listed)
    : t.value.scalpAiQuestion(sessionDay.value, props.limit, listed);

  try {
    const res = await fetch(apiUrl("/api/ask"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...aiHeaders() },
      body: JSON.stringify({ question, lang: lang.value, mode: "ai" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const ranked = [];
    const seen = new Set();
    for (const pick of data.picks || []) {
      const code = tickerCode(pick.ticker);
      const row = byCode.get(code);
      if (!row || seen.has(code)) continue;
      seen.add(code);
      ranked.push(row);
    }
    items.value = ranked.length ? ranked : localItems;
  } catch {
    items.value = localItems;
  }
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    if (isLocal.value) await loadLocal();
    else await loadAi();
  } catch (err) {
    error.value = err.message;
    items.value = [];
  } finally {
    loading.value = false;
    loadedOnce.value = true;
  }
}

function openStock(ticker) {
  const code = tickerCode(ticker);
  if (code) router.push({ name: "stock", params: { ticker: code } });
}

onMounted(load);
watch(() => [props.limit, props.mode, props.horizon], load);
</script>

<template>
  <section
    class="scalp-section"
    :class="{
      'scalp-section--local': isLocal,
      'scalp-section--ai': !isLocal,
    }"
  >
    <div class="scalp-head">
      <div>
        <span class="scalp-mode-badge" :class="isLocal ? 'local' : 'ai'">
          {{ isLocal ? t.scalpLocalBadge : t.scalpAiBadge }}
        </span>
        <h2>{{ title }}</h2>
      </div>
      <button type="button" class="chip" :disabled="loading" @click="load">
        {{ loading ? t.loading : t.scalpRefresh }}
      </button>
    </div>

    <p v-if="loading && !items.length" class="ai-status">{{ t.loading }}</p>
    <p v-else-if="error" class="ai-error">{{ t.aiError }}: {{ error }}</p>
    <p v-else-if="!items.length" class="empty scalp-empty">
      {{ loadedOnce ? t.scalpEmpty : t.scalpIdle }}
    </p>

    <div v-else class="pick-grid scalp-grid">
      <article
        v-for="item in items"
        :key="item.ticker"
        class="pick-card scalp-card scalp-card--simple"
        @click="openStock(item.ticker)"
      >
        <div class="pick-top">
          <strong>{{ tickerCode(item.ticker) }}</strong>
        </div>
        <p class="pick-name">{{ lang === "ar" ? item.nameAr : item.nameEn }}</p>
        <div class="scalp-prices">
          <div class="scalp-buy">
            <span>{{ t.scalpBuy }}</span>
            <strong>{{ fmt(planOf(item)?.buy) }}</strong>
          </div>
          <div class="scalp-sell">
            <span>{{ t.scalpSell }}</span>
            <strong>{{ fmt(planOf(item)?.sell) }}</strong>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
