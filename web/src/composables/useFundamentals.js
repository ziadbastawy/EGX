import { computed, onMounted, onUnmounted, ref } from "vue";
import { publicUrl } from "../lib/api.js";

/**
 * Loads /fundamentals.json (produced by `npm run scrape:fundamentals`) and
 * exposes a lookup by ticker so cards can show P/E, EPS, market cap, etc.
 * Polls so the data appears once the startup scrape finishes.
 */
export function useFundamentals({ poll = true, pollMs = 30_000 } = {}) {
  const payload = ref({ results: [], scrapedAt: null });
  const loading = ref(true);
  const error = ref(null);
  let timer = null;

  const byTicker = computed(() => {
    const map = new Map();
    for (const row of payload.value.results || []) {
      const t = String(row.ticker || "").toUpperCase();
      if (t) map.set(t, row);
      if (row.code) map.set(String(row.code).toUpperCase(), row);
    }
    return map;
  });

  function get(ticker) {
    const raw = String(ticker || "").toUpperCase();
    const withCa = raw.endsWith(".CA") ? raw : `${raw}.CA`;
    const without = withCa.replace(/\.CA$/, "");
    return byTicker.value.get(withCa) || byTicker.value.get(without) || null;
  }

  async function load() {
    try {
      const res = await fetch(`${publicUrl("fundamentals.json")}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      payload.value = await res.json();
      error.value = null;
    } catch (err) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => {
    load();
    if (poll) timer = setInterval(load, pollMs);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { payload, loading, error, get, load };
}
