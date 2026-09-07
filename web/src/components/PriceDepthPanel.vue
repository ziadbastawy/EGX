<script setup>
import { computed } from "vue";
import { useI18n } from "../composables/useI18n.js";
import { buildPriceDepth } from "../../../src/lib/priceDepth.js";

const props = defineProps({
  quote: { type: Object, default: null },
  locale: { type: String, default: "ar-EG-u-nu-latn" },
});

const { t } = useI18n();

const depth = computed(() => {
  if (!props.quote?.candles?.length) return null;
  return buildPriceDepth(props.quote, { levels: 10 });
});

const hasLadder = computed(
  () => (depth.value?.bids?.length || 0) + (depth.value?.asks?.length || 0) > 0
);

function fmt(n, d = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(props.locale, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function fmtVol(n) {
  if (n == null || Number.isNaN(Number(n)) || n <= 0) return "—";
  return Number(n).toLocaleString(props.locale, { maximumFractionDigits: 0 });
}

function tickDecimals(tick) {
  const s = Number(tick || 0)
    .toFixed(8)
    .replace(/0+$/, "")
    .split(".")[1];
  return s ? s.length : 2;
}
</script>

<template>
  <section id="depth" class="depth-panel">
    <div class="analysis-head">
      <div>
        <h2>{{ t.depthTitle }}</h2>
        <p>{{ t.depthLede }}</p>
      </div>
    </div>

    <p v-if="!quote" class="empty">{{ t.stockMissing }}</p>
    <p v-else-if="!hasLadder" class="empty">{{ t.depthEmpty }}</p>

    <template v-else>
      <div class="depth-meta">
        <span>{{ t.nowPrice }}: <strong>{{ fmt(depth.last, tickDecimals(depth.tick)) }}</strong></span>
        <span>{{ t.depthPoc }}: <strong>{{ fmt(depth.poc, tickDecimals(depth.tick)) }}</strong></span>
        <span>{{ t.depthTick }}: {{ depth.tick }}</span>
        <span>{{ t.depthCandles }}: {{ depth.candleCount }}</span>
      </div>

      <div class="depth-book">
        <div class="depth-col depth-asks">
          <div class="depth-col-head">{{ t.depthAsks }}</div>
          <div
            v-for="row in [...depth.asks].reverse()"
            :key="'a' + row.price"
            class="depth-row ask"
          >
            <span class="depth-px">{{ fmt(row.price, tickDecimals(depth.tick)) }}</span>
            <span class="depth-bar-wrap">
              <span class="depth-bar" :style="{ width: `${Math.round((row.bar || 0) * 100)}%` }" />
            </span>
            <span class="depth-vol">{{ fmtVol(row.volume) }}</span>
          </div>
        </div>

        <div class="depth-last">
          <span>{{ t.nowPrice }}</span>
          <strong>{{ fmt(depth.last, tickDecimals(depth.tick)) }} {{ depth.currency }}</strong>
        </div>

        <div class="depth-col depth-bids">
          <div class="depth-col-head">{{ t.depthBids }}</div>
          <div v-for="row in depth.bids" :key="'b' + row.price" class="depth-row bid">
            <span class="depth-px">{{ fmt(row.price, tickDecimals(depth.tick)) }}</span>
            <span class="depth-bar-wrap">
              <span class="depth-bar" :style="{ width: `${Math.round((row.bar || 0) * 100)}%` }" />
            </span>
            <span class="depth-vol">{{ fmtVol(row.volume) }}</span>
          </div>
        </div>
      </div>

      <p class="ai-disclaimer">{{ t.depthDisclaimer }}</p>
    </template>
  </section>
</template>
