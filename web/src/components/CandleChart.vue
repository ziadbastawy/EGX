<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps({
  quote: { type: Object, required: true },
  lang: { type: String, default: "ar" },
  locale: { type: String, default: "ar-EG-u-nu-latn" },
  asOfLabel: String,
  hoverLabel: String,
  hint: String,
});

const canvas = ref(null);
const hoverInfo = ref("");
let layout = null;

const title = computed(() => {
  const name =
    props.lang === "ar"
      ? props.quote.nameAr || props.quote.name || ""
      : props.quote.nameEn || props.quote.name || "";
  return `${props.quote.ticker.replace(".CA", "")} — ${name}`;
});

function fmt(n, d = 2) {
  return Number(n).toLocaleString(props.locale, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(props.locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const subtitle = computed(() => {
  const asOf = props.quote.asOf ? fmtDate(Date.parse(props.quote.asOf)) : "—";
  return `${fmt(props.quote.price)} EGP · ${props.asOfLabel} ${asOf}`;
});

function draw() {
  const el = canvas.value;
  if (!el) return;
  const ctx = el.getContext("2d");
  const candles = props.quote.candles || [];
  const dpr = window.devicePixelRatio || 1;
  const cssW = el.clientWidth;
  const cssH = el.clientHeight;
  el.width = Math.floor(cssW * dpr);
  el.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const pad = { t: 16, r: 56, b: 28, l: 12 };
  const w = cssW - pad.l - pad.r;
  const h = cssH - pad.t - pad.b;
  ctx.clearRect(0, 0, cssW, cssH);
  if (!candles.length) return;

  let min = Infinity;
  let max = -Infinity;
  for (const c of candles) {
    min = Math.min(min, c.l);
    max = Math.max(max, c.h);
  }
  const span = Math.max(max - min, 0.01);
  min -= span * 0.06;
  max += span * 0.06;

  ctx.strokeStyle = "rgba(243,239,230,0.08)";
  ctx.fillStyle = "rgba(243,239,230,0.45)";
  ctx.font = "12px Cairo, IBM Plex Sans, sans-serif";
  ctx.textAlign = "left";
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (h * i) / 4;
    const val = max - ((max - min) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + w, y);
    ctx.stroke();
    ctx.fillText(fmt(val), pad.l + w + 8, y + 4);
  }

  const slot = w / candles.length;
  const bodyW = Math.max(2, Math.min(10, slot * 0.62));
  layout = { pad, slot, candles };

  candles.forEach((c, i) => {
    const x = pad.l + slot * i + slot / 2;
    const yH = pad.t + ((max - c.h) / (max - min)) * h;
    const yL = pad.t + ((max - c.l) / (max - min)) * h;
    const yO = pad.t + ((max - c.o) / (max - min)) * h;
    const yC = pad.t + ((max - c.c) / (max - min)) * h;
    const up = c.c >= c.o;
    const color = up ? "#2fbf71" : "#ef5b4d";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, yH);
    ctx.lineTo(x, yL);
    ctx.stroke();
    ctx.fillRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)));
  });
}

function onMove(e) {
  if (!layout || !canvas.value) return;
  const x = e.clientX - canvas.value.getBoundingClientRect().left;
  const i = Math.floor((x - layout.pad.l) / layout.slot);
  const c = layout.candles[i];
  if (!c) {
    hoverInfo.value = props.hoverLabel;
    return;
  }
  const up = c.c >= c.o;
  hoverInfo.value = `${fmtDate(c.t)} · O ${fmt(c.o)} H ${fmt(c.h)} L ${fmt(c.l)} C ${fmt(c.c)} ${up ? "▲" : "▼"}`;
}

onMounted(async () => {
  hoverInfo.value = props.hoverLabel;
  await nextTick();
  draw();
  window.addEventListener("resize", draw);
});

onUnmounted(() => window.removeEventListener("resize", draw));

watch(
  () => [props.quote, props.lang, props.locale],
  async () => {
    hoverInfo.value = props.hoverLabel;
    await nextTick();
    draw();
  },
  { deep: true }
);
</script>

<template>
  <section class="chart-panel">
    <div class="chart-head">
      <div>
        <h2>{{ title }}</h2>
        <div class="sub">{{ subtitle }}</div>
      </div>
      <div class="sub">{{ hoverInfo }}</div>
    </div>
    <canvas ref="canvas" width="1080" height="360" @mousemove="onMove" />
    <div class="hint">{{ hint }}</div>
  </section>
</template>
