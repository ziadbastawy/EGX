import { computed, onMounted, onUnmounted, ref } from "vue";
import { publicUrl } from "../lib/api.js";

/** Home polls latest.json to match the scrape script. Detail loads once. */
export function useMarketData({ poll = false, pollMs = 20_000 } = {}) {
  const payload = ref({ results: [], errors: [], scrapedAt: null, range: null });
  const loading = ref(true);
  const error = ref(null);
  let timer = null;

  const results = computed(() => payload.value.results || []);

  async function load() {
    try {
      const res = await fetch(`${publicUrl("latest.json")}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      payload.value = await res.json();
      error.value = null;
    } catch (err) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  function findByTicker(ticker) {
    const raw = String(ticker || "").toUpperCase();
    const withCa = raw.endsWith(".CA") ? raw : `${raw}.CA`;
    const without = withCa.replace(/\.CA$/, "");
    return (
      results.value.find(
        (q) =>
          q.ticker === withCa ||
          q.ticker === without ||
          q.ticker.replace(/\.CA$/, "") === without
      ) || null
    );
  }

  onMounted(() => {
    load();
    if (poll) timer = setInterval(load, pollMs);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { payload, results, loading, error, load, findByTicker };
}
