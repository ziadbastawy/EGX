<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "../composables/useI18n.js";
import { apiUrl } from "../lib/api.js";

const props = defineProps({
  locale: { type: String, default: "ar-EG-u-nu-latn" },
  limit: { type: Number, default: 5 },
});

const { lang, t } = useI18n();
const router = useRouter();

const data = ref(null);
const error = ref(null);
const loading = ref(false);
let timer = null;

async function load() {
  loading.value = true;
  try {
    const res = await fetch(apiUrl(`/api/flow?limit=${props.limit}`));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    data.value = body;
    error.value = null;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
  timer = setInterval(load, 60_000);
});
onUnmounted(() => clearInterval(timer));

const test = computed(() => data.value?.model?.test || null);
const maxP = computed(() => Math.max(...(data.value?.items || []).map((i) => i.probability), 0.01));

function pct(n, d = 1) {
  if (n == null) return "—";
  return `${(n * 100).toLocaleString(props.locale, { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
}

function name(item) {
  return (lang.value === "ar" ? item.nameAr || item.nameEn : item.nameEn || item.nameAr) || item.ticker;
}

function code(ticker) {
  return String(ticker || "").replace(/\.CA$/i, "");
}

function open(item) {
  router.push({ name: "stock", params: { ticker: code(item.ticker) } });
}
</script>

<template>
  <section class="flow-panel">
    <div class="flow-head">
      <div>
        <span class="calc-badge">{{ t.flowBadge }}</span>
        <h2>{{ t.flowTitle }}</h2>
        <p>{{ t.flowLede }}</p>
      </div>
      <button type="button" class="chip" :disabled="loading" @click="load">
        {{ loading ? t.loading : t.scalpRefresh }}
      </button>
    </div>

    <p v-if="error" class="ai-error">{{ t.aiError }}: {{ error }}</p>

    <template v-else-if="data">
      <ol class="flow-list">
        <li v-for="(item, i) in data.items" :key="item.ticker" @click="open(item)">
          <span class="flow-rank">{{ i + 1 }}</span>
          <div class="flow-id">
            <strong>{{ code(item.ticker) }}</strong>
            <span>{{ name(item) }}</span>
          </div>
          <div class="flow-meter">
            <span class="flow-bar"><span :style="{ width: `${(item.probability / maxP) * 100}%` }" /></span>
            <span class="flow-p"><bdi dir="ltr">{{ pct(item.probability) }}</bdi></span>
            <span class="flow-lift" :class="{ hi: item.lift >= 1.5 }"><bdi dir="ltr">×{{ item.lift.toFixed(1) }}</bdi></span>
          </div>
          <div class="flow-why">
            <span v-for="d in item.drivers" :key="d" class="flow-chip">{{ t.flowDriver[d] || d }}</span>
          </div>
        </li>
      </ol>

      <p v-if="test" class="backtest-warn">
        {{ t.flowNote(pct(test.precision), pct(test.baseRate), pct(test.rulePrecision), test.from, test.to) }}
      </p>
    </template>
    <p v-else class="ai-status">{{ t.loading }}</p>
  </section>
</template>
