<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "../composables/useI18n.js";
import { useMarketData } from "../composables/useMarketData.js";
import { useMyFunds } from "../composables/useMyFunds.js";
import { useAiSettings } from "../composables/useAiSettings.js";
import { apiUrl } from "../lib/api.js";
import { extractHoldingsFromPhoto } from "../lib/extractFundsPhoto.js";
import { analyzeUniverse } from "../../../src/lib/indicators.js";
import {
  THNDR_FUNDS,
  adviseHolding,
  adviseMoves,
  outsideBuyIdeas,
  scoreThndrFunds,
} from "../../../src/lib/thndrFunds.js";

const { lang, t, locale } = useI18n();
const { payload, results, loading, error } = useMarketData({ poll: true, pollMs: 30_000 });
const { holdings, totalAmount, totalValue, totalPnl, totalPnlPct, upsert, replaceAll, remove } =
  useMyFunds();
const { state, aiHeaders } = useAiSettings();

const form = ref({ code: THNDR_FUNDS[0]?.code || "", amount: "", pnlPct: "" });
const formError = ref("");
const photoBusy = ref(false);
const photoError = ref("");
const fileInput = ref(null);
const fundBox = ref(null);
const fundOpen = ref(false);
const fundQuery = ref("");
const fundHi = ref(0);
const editOpen = ref(false);
const editForm = ref({ code: "", amount: "", pnlPct: "" });
const addOpen = ref(false);
const addTab = ref("manual"); // "manual" | "photo"
const aiBusy = ref(false);
const aiError = ref("");
const aiAdvice = ref(null);
const askQ = ref("");
const askBusy = ref(false);
const askError = ref("");
const askAnswer = ref("");

const scored = computed(() => {
  if (!results.value.length) return [];
  return scoreThndrFunds(analyzeUniverse(results.value));
});

const scoredByCode = computed(() => new Map(scored.value.map((f) => [f.code, f])));

const catalog = computed(() => {
  const ar = lang.value === "ar";
  return [...THNDR_FUNDS].sort((a, b) =>
    String(ar ? a.nameAr : a.nameEn).localeCompare(String(ar ? b.nameAr : b.nameEn), ar ? "ar" : "en")
  );
});

const selectedFund = computed(
  () => catalog.value.find((f) => f.code === form.value.code) || catalog.value[0] || null
);

const filteredCatalog = computed(() => {
  const q = fundQuery.value.trim().toLowerCase();
  if (!q || !fundOpen.value) return catalog.value;
  const compact = q.replace(/\s+/g, "");
  return catalog.value.filter((f) => {
    const blob = `${f.code} ${f.nameAr} ${f.nameEn} ${f.manager || ""}`.toLowerCase();
    return blob.includes(q) || blob.replace(/\s+/g, "").includes(compact);
  });
});

function fundLabel(f) {
  if (!f) return "";
  return `${f.code} — ${nameOf(f)}`;
}

function syncFundInput() {
  fundQuery.value = fundLabel(selectedFund.value);
}

function openFundList() {
  fundOpen.value = true;
  fundQuery.value = "";
  fundHi.value = Math.max(
    0,
    filteredCatalog.value.findIndex((f) => f.code === form.value.code)
  );
}

function closeFundList() {
  fundOpen.value = false;
  syncFundInput();
}

function pickFund(f) {
  if (!f) return;
  form.value.code = f.code;
  closeFundList();
}

function onFundKey(e) {
  const list = filteredCatalog.value;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!fundOpen.value) openFundList();
    else fundHi.value = Math.min(list.length - 1, fundHi.value + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    fundHi.value = Math.max(0, fundHi.value - 1);
  } else if (e.key === "Enter" && fundOpen.value) {
    e.preventDefault();
    pickFund(list[fundHi.value] || list[0]);
  } else if (e.key === "Escape") {
    closeFundList();
  }
}

function onDocPointer(e) {
  if (fundOpen.value && !fundBox.value?.contains(e.target)) closeFundList();
}

watch([selectedFund, lang], () => {
  if (!fundOpen.value) syncFundInput();
});

onMounted(() => {
  syncFundInput();
  document.addEventListener("pointerdown", onDocPointer);
});
onUnmounted(() => document.removeEventListener("pointerdown", onDocPointer));

const rows = computed(() =>
  holdings.map((h) => {
    const fund =
      scoredByCode.value.get(h.code) ||
      THNDR_FUNDS.find((f) => f.code === h.code) || {
        code: h.code,
        nameAr: h.name,
        nameEn: h.name,
      };
    return { holding: h, fund, local: adviseHolding(h, fund) };
  })
);

const moves = computed(() => adviseMoves(rows.value));
const outside = computed(() =>
  outsideBuyIdeas(
    scored.value,
    new Set(holdings.map((h) => h.code)),
    { limit: 6 }
  )
);

function nameOf(fund) {
  if (!fund) return "";
  return lang.value === "ar" ? fund.nameAr || fund.nameEn : fund.nameEn || fund.nameAr;
}

function lineOf(obj) {
  if (!obj) return "";
  return lang.value === "ar" ? obj.lineAr || obj.reasonAr : obj.lineEn || obj.reasonEn;
}

function fmtMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(locale.value, { maximumFractionDigits: 0 });
}

function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toLocaleString(locale.value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function onSave() {
  formError.value = "";
  if (!upsert(form.value)) {
    formError.value = t.value.myFundsFormError;
    return;
  }
  form.value.amount = "";
  form.value.pnlPct = "";
  closeAdd();
}

function openAdd(tab = "manual") {
  formError.value = "";
  photoError.value = "";
  addTab.value = tab === "photo" ? "photo" : "manual";
  addOpen.value = true;
}

function closeAdd() {
  addOpen.value = false;
  fundOpen.value = false;
  syncFundInput();
}

function openEdit(row) {
  editForm.value = {
    code: row.holding.code,
    amount: String(row.holding.amount ?? ""),
    pnlPct: String(row.holding.pnlPct ?? ""),
    name: row.holding.name || nameOf(row.fund),
  };
  editOpen.value = true;
}

function closeEdit() {
  editOpen.value = false;
}

function saveEdit() {
  formError.value = "";
  if (!upsert(editForm.value)) {
    formError.value = t.value.myFundsFormError;
    return;
  }
  closeEdit();
}

async function askFundsAi() {
  if (!holdings.length || aiBusy.value) return;
  aiBusy.value = true;
  aiError.value = "";
  aiAdvice.value = null;
  const body = {
    lang: lang.value,
    holdings: rows.value.map((r) => ({
      code: r.holding.code,
      name: nameOf(r.fund),
      current: r.holding.amount,
      cost: r.local.amount,
      pnlAbs: r.local.pnlAbs,
      pnlPct: r.holding.pnlPct,
      localAction: r.local.action,
      tape: r.fund?.stance || r.local.tapeStance,
      kind: r.fund?.kind,
    })),
    outside: outside.value.map((f) => ({
      code: f.code,
      name: nameOf(f),
      stance: f.stance,
      why: lang.value === "ar" ? f.lineAr || f.reasonAr : f.lineEn || f.reasonEn,
    })),
    catalog: scored.value.map((f) => ({
      code: f.code,
      name: nameOf(f),
      kind: f.kind,
      stance: f.stance,
    })),
  };
  const urls = [];
  const add = (u) => {
    if (u && !urls.includes(u)) urls.push(u);
  };
  add(apiUrl("/api/funds-advice"));
  add("/api/funds-advice");
  try {
    let lastErr = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...aiHeaders() },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 404 || res.status === 405) {
          lastErr = new Error("api missing");
          continue;
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        aiAdvice.value = data;
        return;
      } catch (err) {
        lastErr = err;
        if (!/failed to fetch|networkerror|load failed|api missing/i.test(String(err.message))) {
          throw err;
        }
      }
    }
    throw lastErr || new Error(t.value.myFundsAiMissing);
  } catch (err) {
    aiError.value = err.message;
  } finally {
    aiBusy.value = false;
  }
}

async function askAny() {
  const q = askQ.value.trim();
  if (!q || askBusy.value) return;
  askBusy.value = true;
  askError.value = "";
  askAnswer.value = "";
  const ctx = holdings.length
    ? rows.value
        .map(
          (r) =>
            `${r.holding.code} current=${r.holding.amount} pct=${r.holding.pnlPct} action=${r.local.action}`
        )
        .join("; ")
    : "";
  const question = ctx ? `${q}\n\n[holdings: ${ctx}]` : q;
  const urls = [];
  const add = (u) => {
    if (u && !urls.includes(u)) urls.push(u);
  };
  add("/api/ask");
  add(apiUrl("/api/ask"));
  try {
    let lastErr = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...aiHeaders() },
          body: JSON.stringify({ question: question.slice(0, 2000), lang: lang.value, mode: "ai" }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 404 || res.status === 405) {
          lastErr = new Error("api missing");
          continue;
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        askAnswer.value = data.answer || data.summary || JSON.stringify(data);
        return;
      } catch (err) {
        lastErr = err;
        if (!/failed to fetch|networkerror|load failed|api missing/i.test(String(err.message))) {
          throw err;
        }
      }
    }
    throw lastErr || new Error(t.value.myFundsAskMissing);
  } catch (err) {
    const msg = String(err.message || "");
    askError.value = /failed to fetch|networkerror|load failed|api missing/i.test(msg)
      ? t.value.myFundsAskMissing
      : msg;
  } finally {
    askBusy.value = false;
  }
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 2048;
      let { width, height } = img;
      const scale = Math.min(1, max / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("bad image"));
    };
    img.src = url;
  });
}

async function onPhoto(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  photoBusy.value = true;
  photoError.value = "";
  try {
    const image = await resizeImage(file);
    const { holdings, apiMissing } = await extractHoldingsFromPhoto(image, {
      apiUrl: apiUrl("/api/funds-photo"),
      headers: aiHeaders(),
      openaiKey: state.openaiKey,
      openaiModel: state.openaiModel,
    });
    if (!holdings.length) {
      throw new Error(apiMissing ? t.value.myFundsPhotoApiMissing : t.value.myFundsPhotoEmpty);
    }
    replaceAll(holdings);
    closeAdd();
  } catch (err) {
    photoError.value = err.message;
  } finally {
    photoBusy.value = false;
  }
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale.value);
}
</script>

<template>
  <div class="funds-page my-funds-page">
    <RouterLink class="back" :to="{ name: 'funds' }">{{ t.back }}</RouterLink>
    <header class="scalp-page-head">
      <h1>{{ t.myFundsTitle }}</h1>
      <p>{{ t.myFundsLede }}</p>
      <p v-if="payload.scrapedAt" class="funds-asof">{{ t.scraped }}: {{ fmtDateTime(payload.scrapedAt) }}</p>
    </header>

    <div class="my-funds-add-bar">
      <button type="button" class="ai-btn" @click="openAdd('manual')">{{ t.myFundsAdd }}</button>
    </div>

    <teleport to="body">
      <div v-if="addOpen" class="settings-overlay" @click.self="closeAdd">
        <div class="settings-modal my-funds-add-modal" role="dialog" aria-modal="true">
          <div class="settings-modal-head">
            <h3>{{ t.myFundsAddTitle }}</h3>
            <button type="button" class="settings-close" :aria-label="t.settingsDone" @click="closeAdd">
              ✕
            </button>
          </div>

          <div class="my-funds-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              :class="{ active: addTab === 'manual' }"
              :aria-selected="addTab === 'manual'"
              @click="addTab = 'manual'"
            >
              {{ t.myFundsTabManual }}
            </button>
            <button
              type="button"
              role="tab"
              :class="{ active: addTab === 'photo' }"
              :aria-selected="addTab === 'photo'"
              @click="addTab = 'photo'"
            >
              {{ t.myFundsTabPhoto }}
            </button>
          </div>

          <form
            v-show="addTab === 'manual'"
            class="my-funds-form in-modal"
            @submit.prevent="onSave"
          >
            <div ref="fundBox" class="fund-combo settings-field">
              <span class="settings-label">{{ t.myFundsPick }}</span>
              <input
                v-model="fundQuery"
                type="search"
                class="fund-combo-input"
                autocomplete="off"
                :placeholder="t.myFundsSearchPh"
                :aria-expanded="fundOpen"
                aria-autocomplete="list"
                role="combobox"
                @focus="openFundList"
                @input="fundOpen = true; fundHi = 0"
                @keydown="onFundKey"
              />
              <ul v-show="fundOpen" class="fund-combo-menu" role="listbox">
                <li v-if="!filteredCatalog.length" class="fund-combo-empty">{{ t.searchNoResults }}</li>
                <li
                  v-for="(f, i) in filteredCatalog"
                  :key="f.code"
                  class="fund-combo-item"
                  :class="{ active: form.code === f.code, hi: i === fundHi }"
                  role="option"
                  @mousedown.prevent="pickFund(f)"
                >
                  <span class="fund-combo-code">{{ f.code }}</span>
                  <span class="fund-combo-name">{{ nameOf(f) }}</span>
                  <span v-if="f.manager" class="fund-combo-mgr">{{ f.manager }}</span>
                </li>
              </ul>
            </div>
            <div class="my-funds-form-nums">
              <label class="settings-field">
                <span class="settings-label">{{ t.myFundsAmount }}</span>
                <input v-model="form.amount" type="text" inputmode="decimal" autocomplete="off" />
              </label>
              <label class="settings-field">
                <span class="settings-label">{{ t.myFundsPnl }}</span>
                <input
                  v-model="form.pnlPct"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  :placeholder="t.myFundsPnlPh"
                />
              </label>
              <button type="submit" class="ai-btn my-funds-save">{{ t.myFundsSave }}</button>
            </div>
          </form>
          <p v-if="addTab === 'manual' && formError" class="ai-error">{{ formError }}</p>

          <div v-show="addTab === 'photo'" class="my-funds-photo in-modal">
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              @change="onPhoto"
            />
            <button
              type="button"
              class="ai-btn"
              :disabled="photoBusy"
              @click="fileInput?.click()"
            >
              {{ photoBusy ? t.myFundsPhotoBusy : t.myFundsPhoto }}
            </button>
            <p class="muted">{{ t.myFundsPhotoHint }}</p>
            <p v-if="photoError" class="ai-error">{{ photoError }}</p>
          </div>
        </div>
      </div>
    </teleport>

    <p v-if="loading" class="empty">{{ t.loading }}</p>
    <p v-else-if="error" class="empty">{{ t.loadError }}: {{ error }}</p>

    <div v-if="holdings.length" class="my-funds-totals">
      <div>
        <span>{{ t.myFundsInvested }}</span>
        <strong>{{ fmtMoney(totalAmount) }}</strong>
      </div>
      <div>
        <span>{{ t.myFundsNow }}</span>
        <strong>{{ fmtMoney(totalValue) }}</strong>
      </div>
      <div :class="totalPnl >= 0 ? 'up' : 'down'">
        <span>{{ t.myFundsPnlAbs }}</span>
        <strong>{{ fmtMoney(totalPnl) }} ({{ fmtPct(totalPnlPct) }})</strong>
      </div>
    </div>

    <p class="my-funds-settle">{{ t.myFundsSettlement }}</p>
    <p v-for="m in moves" :key="m.from + m.to" class="my-funds-move">
      {{
        t.myFundsMove(
          lang === "ar" ? m.fromNameAr : m.fromNameEn,
          lang === "ar" ? m.toNameAr : m.toNameEn
        )
      }}
    </p>

    <p v-if="!holdings.length" class="empty">{{ t.myFundsEmpty }}</p>

    <template v-else>
      <h2 class="scalp-group-title">{{ t.myFundsEachTitle }}</h2>
      <div class="my-funds-list">
        <article v-for="row in rows" :key="row.holding.id" class="fund-card my-hold-card" :class="row.local.action">
          <div class="fund-card-top">
            <div class="sym">{{ row.holding.code }}</div>
            <span class="badge fund-stance">{{ t.fundsStance[row.local.action] || row.local.action }}</span>
          </div>
          <h3 class="fund-name">{{ nameOf(row.fund) }}</h3>
          <dl class="my-hold-stats">
            <div>
              <dt>{{ t.myFundsCost }}</dt>
              <dd>{{ fmtMoney(row.local.amount) }}</dd>
            </div>
            <div :class="row.local.pnlAbs >= 0 ? 'up' : 'down'">
              <dt>{{ t.myFundsProfit }}</dt>
              <dd>{{ fmtMoney(row.local.pnlAbs) }}</dd>
            </div>
            <div :class="row.holding.pnlPct >= 0 ? 'up' : 'down'">
              <dt>{{ t.myFundsPct }}</dt>
              <dd>{{ fmtPct(row.holding.pnlPct) }}</dd>
            </div>
            <div>
              <dt>{{ t.myFundsRemain }}</dt>
              <dd>{{ fmtMoney(row.holding.amount) }}</dd>
            </div>
          </dl>
          <p class="fund-line">{{ lineOf(row.local) }}</p>
          <div class="my-hold-actions">
            <button type="button" class="btn-secondary" @click="openEdit(row)">{{ t.myFundsEdit }}</button>
            <button type="button" class="my-funds-del" @click="remove(row.holding.id)">
              {{ t.myFundsRemove }}
            </button>
          </div>
        </article>
      </div>
    </template>

    <template v-if="holdings.length">
      <h2 class="scalp-group-title">{{ t.myFundsOutsideTitle }}</h2>
      <p v-if="!outside.length" class="empty">{{ t.myFundsOutsideEmpty }}</p>
      <div v-else class="funds-grid">
        <article v-for="f in outside" :key="f.code" class="fund-card add">
          <div class="fund-card-top">
            <div class="sym">{{ f.code }}</div>
            <span class="badge fund-stance">{{ t.fundsStance.add }}</span>
          </div>
          <h3 class="fund-name">{{ nameOf(f) }}</h3>
          <p class="fund-reason">{{ lineOf(f) }}</p>
        </article>
      </div>
    </template>

    <section v-if="holdings.length" class="my-funds-ai">
      <button type="button" class="ai-btn" :disabled="aiBusy" @click="askFundsAi">
        {{ aiBusy ? t.myFundsAiBusy : t.myFundsAiCta }}
      </button>
      <p class="muted">{{ t.myFundsAiHint }}</p>
      <p v-if="aiError" class="ai-error">{{ aiError }}</p>
      <div v-if="aiAdvice" class="my-funds-ai-box">
        <h2 class="scalp-group-title">{{ t.myFundsAiTitle }}</h2>
        <p v-if="aiAdvice.summary" class="my-funds-ai-summary">{{ aiAdvice.summary }}</p>
        <article
          v-for="(a, i) in aiAdvice.actions"
          :key="a.code + i"
          class="fund-card"
          :class="a.action"
        >
          <div class="fund-card-top">
            <div class="sym">{{ a.code }}</div>
            <span class="badge fund-stance">{{ t.fundsStance[a.action] || a.action }}</span>
          </div>
          <h3 class="fund-name">{{ a.name || a.code }}</h3>
          <p v-if="a.egp" class="fund-line">{{ fmtMoney(a.egp) }} {{ t.myFundsEgp }}</p>
          <p class="fund-reason">{{ a.why }}</p>
        </article>
      </div>
    </section>

    <section class="my-funds-ask">
      <h2 class="scalp-group-title">{{ t.myFundsAskTitle }}</h2>
      <form class="ai-ask-form" @submit.prevent="askAny">
        <input
          v-model="askQ"
          type="text"
          class="ai-ask-input"
          :placeholder="t.myFundsAskPh"
          :disabled="askBusy"
          autocomplete="off"
        />
        <button type="submit" class="ai-btn" :disabled="askBusy || !askQ.trim()">
          {{ askBusy ? t.aiLoading : t.aiSend }}
        </button>
      </form>
      <p v-if="askError" class="ai-error">{{ askError }}</p>
      <p v-else-if="askAnswer" class="ai-answer my-funds-ask-answer">{{ askAnswer }}</p>
    </section>

    <p class="ai-disclaimer">{{ t.myFundsDisclaimer }}</p>

    <teleport to="body">
      <div v-if="editOpen" class="settings-overlay" @click.self="closeEdit">
        <div class="settings-modal" role="dialog" aria-modal="true">
          <div class="settings-modal-head">
            <h3>{{ t.myFundsEdit }}</h3>
            <button type="button" class="settings-close" @click="closeEdit">✕</button>
          </div>
          <p class="muted">{{ editForm.code }} — {{ editForm.name }}</p>
          <label class="settings-field">
            <span class="settings-label">{{ t.myFundsRemain }}</span>
            <input v-model="editForm.amount" type="text" inputmode="decimal" autocomplete="off" />
          </label>
          <label class="settings-field">
            <span class="settings-label">{{ t.myFundsPct }}</span>
            <input
              v-model="editForm.pnlPct"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              :placeholder="t.myFundsPnlPh"
            />
          </label>
          <button type="button" class="ai-btn" @click="saveEdit">{{ t.myFundsSave }}</button>
        </div>
      </div>
    </teleport>
  </div>
</template>
