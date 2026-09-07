<script setup>
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import CandleChart from "../components/CandleChart.vue";
import PriceDepthPanel from "../components/PriceDepthPanel.vue";
import { useI18n } from "../composables/useI18n.js";
import { useMarketData } from "../composables/useMarketData.js";
import { useAiSettings } from "../composables/useAiSettings.js";
import { apiUrl } from "../lib/api.js";

const props = defineProps({
  ticker: { type: String, required: true },
});

const router = useRouter();
const { lang, t, locale } = useI18n();
const { payload, loading, error, findByTicker } = useMarketData({ poll: false });
const { aiHeaders } = useAiSettings();

const analysis = ref(null);
const analysisError = ref(null);
const analysisLoading = ref(false);

const suggesting = ref(false);
const suggestError = ref(null);
const suggestion = ref(null);

const company = ref(null);
const companyLoading = ref(false);
const companyError = ref(null);

const quote = computed(() => findByTicker(props.ticker));

const name = computed(() => {
  if (!quote.value) return "";
  return lang.value === "ar"
    ? quote.value.nameAr || quote.value.name || quote.value.nameEn || ""
    : quote.value.nameEn || quote.value.name || quote.value.nameAr || "";
});

const up = computed(() => (quote.value?.changePercent ?? 0) >= 0);

const ind = computed(() => analysis.value?.indicators || null);
const trade = computed(() => analysis.value?.trade || null);

const scoreAction = computed(() => {
  const score = analysis.value?.score;
  if (score == null) return "hold";
  if (score >= 60) return "buy";
  if (score <= 35) return "sell";
  return "hold";
});

const scoreActionLabel = computed(() => t.value.aiAction[scoreAction.value] || scoreAction.value);

const trendLabel = computed(() => {
  const trend = ind.value?.trend;
  if (!trend) return "—";
  return t.value.trend[trend] || trend;
});

const signalLabels = computed(() => {
  const map = t.value.signal || {};
  return (analysis.value?.signals || []).map((s) => map[s] || s);
});

function normalizeCa(ticker) {
  const raw = String(ticker || "").trim().toUpperCase();
  if (!raw) return "";
  return raw.endsWith(".CA") ? raw : `${raw}.CA`;
}

// Analyze only when user opens a card (route ticker changes) — not on scrape refresh.
watch(
  () => props.ticker,
  (ticker) => {
    suggestion.value = null;
    suggestError.value = null;
    company.value = null;
    companyError.value = null;
    loadAnalysis(ticker);
    loadCompany(ticker);
  },
  { immediate: true }
);

async function loadCompany(tickerRaw = props.ticker) {
  const ticker = normalizeCa(tickerRaw);
  if (!ticker) {
    company.value = null;
    return;
  }
  companyLoading.value = true;
  companyError.value = null;
  try {
    const res = await fetch(apiUrl(`/api/company?ticker=${encodeURIComponent(ticker)}`));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    company.value = data;
  } catch (err) {
    companyError.value = err.message;
    company.value = null;
  } finally {
    companyLoading.value = false;
  }
}

async function loadAnalysis(tickerRaw = props.ticker) {
  const ticker = normalizeCa(tickerRaw);
  if (!ticker) {
    analysis.value = null;
    return;
  }
  analysisLoading.value = true;
  analysisError.value = null;
  try {
    const res = await fetch(apiUrl(`/api/analyze?ticker=${encodeURIComponent(ticker)}`));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    analysis.value = data.analysis;
  } catch (err) {
    analysisError.value = err.message;
    analysis.value = null;
  } finally {
    analysisLoading.value = false;
  }
}

function fmt(n, d = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(locale.value, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

// Large integers (market cap, shares, capital, volume, turnover) — grouped, no decimals.
function fmtBig(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(locale.value, { maximumFractionDigits: 0 });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale.value);
}

function goBack() {
  router.push({ name: "home" });
}

async function askAi() {
  if (!quote.value || suggesting.value) return;
  suggesting.value = true;
  suggestError.value = null;
  try {
    const res = await fetch(apiUrl("/api/suggest"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...aiHeaders() },
      body: JSON.stringify({ ticker: quote.value.ticker, lang: lang.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    suggestion.value = data.suggestion;
  } catch (err) {
    suggestError.value = err.message;
    suggestion.value = null;
  } finally {
    suggesting.value = false;
  }
}
</script>

<template>
  <div class="detail">
    <button type="button" class="back" @click="goBack">{{ t.back }}</button>

    <p v-if="loading" class="empty">{{ t.loading }}</p>
    <p v-else-if="error" class="empty">{{ t.loadError }}: {{ error }}</p>
    <p v-else-if="!quote" class="empty">{{ t.stockMissing }}</p>

    <template v-else>
      <section class="detail-hero">
        <div class="detail-identity">
          <div class="sym">{{ quote.ticker.replace(".CA", "") }}</div>
          <h1>{{ name }}</h1>
          <p class="detail-meta">
            {{ quote.exchange || "EGX" }} · {{ t.asOf }} {{ fmtDateTime(quote.asOf) }}
          </p>
        </div>

        <div class="detail-price-block">
          <div class="price">{{ fmt(quote.price) }} {{ quote.currency || "EGP" }}</div>
          <div class="chg" :class="up ? 'up' : 'down'">
            <template v-if="quote.change == null">—</template>
            <template v-else>
              {{ quote.change >= 0 ? "+" : "" }}{{ fmt(quote.change) }}
              ·
              {{ quote.changePercent >= 0 ? "+" : "" }}{{ fmt(quote.changePercent) }}%
            </template>
          </div>
          <dl class="stats">
            <div>
              <dt>{{ t.prevClose }}</dt>
              <dd>{{ fmt(quote.previousClose) }}</dd>
            </div>
            <div>
              <dt>{{ t.range }}</dt>
              <dd>{{ payload.range || "—" }}</dd>
            </div>
            <div>
              <dt>{{ t.scraped }}</dt>
              <dd>{{ fmtDateTime(payload.scrapedAt) }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <!-- <PriceDepthPanel :quote="quote" :locale="locale" /> -->

      <section class="company-panel">
        <div class="analysis-head">
          <div>
            <h2>
              {{ t.companyTitle }}
              <a
                v-if="company?.url"
                class="company-source"
                :href="company.url"
                target="_blank"
                rel="noopener noreferrer"
              >{{ t.companySource }}</a>
            </h2>
            <p>{{ t.companyLede }}</p>
            <p class="company-delayed">{{ t.companyDelayed }}</p>
          </div>
          <button type="button" class="chip" :disabled="companyLoading" @click="loadCompany()">
            {{ companyLoading ? t.loading : t.companyRefresh }}
          </button>
        </div>

        <p v-if="companyLoading && !company" class="ai-status">{{ t.companyLoading }}</p>
        <p v-else-if="companyError" class="ai-error">{{ t.companyError }}: {{ companyError }}</p>

        <template v-else-if="company">
          <h3 class="plan-title">{{ t.companyFundamentals }}</h3>
          <dl class="indicator-grid company-grid">
            <div><dt>{{ t.fMarketCap }}</dt><dd>{{ fmtBig(company.fundamentals?.marketCap) }}</dd></div>
            <div><dt>{{ t.fPe }}</dt><dd>{{ fmt(company.fundamentals?.pe) }}</dd></div>
            <div><dt>{{ t.fEps }}</dt><dd>{{ fmt(company.fundamentals?.eps) }}</dd></div>
            <div><dt>{{ t.fBookValue }}</dt><dd>{{ fmt(company.fundamentals?.bookValue) }}</dd></div>
            <div><dt>{{ t.fPb }}</dt><dd>{{ fmt(company.fundamentals?.pb) }}</dd></div>
            <div><dt>{{ t.fParValue }}</dt><dd>{{ fmt(company.fundamentals?.parValue) }}</dd></div>
            <div><dt>{{ t.fShares }}</dt><dd>{{ fmtBig(company.fundamentals?.shares) }}</dd></div>
            <div><dt>{{ t.fCapital }}</dt><dd>{{ fmtBig(company.fundamentals?.capital) }}</dd></div>
            <div><dt>{{ t.fCurrency }}</dt><dd>{{ company.fundamentals?.currency || "—" }}</dd></div>
          </dl>

          <h3 class="plan-title">{{ t.companyDayStats }}</h3>
          <dl class="indicator-grid company-grid">
            <div><dt>{{ t.fOpen }}</dt><dd>{{ fmt(company.summary?.open) }}</dd></div>
            <div><dt>{{ t.fPrevClose }}</dt><dd>{{ fmt(company.summary?.prevClose) }}</dd></div>
            <div><dt>{{ t.fHigh }}</dt><dd>{{ fmt(company.summary?.high) }}</dd></div>
            <div><dt>{{ t.fLow }}</dt><dd>{{ fmt(company.summary?.low) }}</dd></div>
            <div><dt>{{ t.fVolume }}</dt><dd>{{ fmtBig(company.summary?.volume) }}</dd></div>
            <div><dt>{{ t.fTurnover }}</dt><dd>{{ fmtBig(company.summary?.turnover) }}</dd></div>
          </dl>

          <div v-if="company.news?.length" class="company-news">
            <h3 class="plan-title">{{ t.companyNewsTitle }}</h3>
            <ul>
              <li v-for="(item, i) in company.news" :key="'n' + i">
                <a :href="item.href" target="_blank" rel="noopener noreferrer">{{ item.title }}</a>
                <span v-if="item.category" class="company-tag">{{ item.category }}</span>
              </li>
            </ul>
          </div>

          <div v-if="company.announcements?.length" class="company-news">
            <h3 class="plan-title">{{ t.companyAnnouncementsTitle }}</h3>
            <ul>
              <li v-for="(item, i) in company.announcements" :key="'a' + i">
                <a :href="item.href" target="_blank" rel="noopener noreferrer">{{ item.title }}</a>
                <span v-if="item.date" class="company-date">{{ item.date }}</span>
              </li>
            </ul>
          </div>

          <p class="ai-disclaimer">{{ t.companyDisclaimer }}</p>
        </template>
      </section>

      <section class="analysis-panel" :class="scoreAction">
        <div class="analysis-head">
          <div>
            <h2>
              {{ t.analysisTitle }}
              <span class="calc-badge">{{ t.analysisCalcBadge }}</span>
            </h2>
            <p>{{ t.analysisLede }}</p>
            <p class="calc-note">{{ t.analysisCalcNote }}</p>
          </div>
          <div class="score-box" v-if="analysis">
            <span class="score-num">{{ analysis.score }}/100</span>
            <span class="badge">{{ scoreActionLabel }}</span>
          </div>
        </div>

        <p v-if="analysisLoading" class="ai-status">{{ t.loading }}</p>
        <p v-else-if="analysisError" class="ai-error">{{ t.aiError }}: {{ analysisError }}</p>

        <template v-else-if="analysis">
          <dl class="pick-levels detail-levels analysis-trade">
            <div>
              <dt>{{ t.aiEntry }}</dt>
              <dd>{{ fmt(trade?.entry) }}</dd>
            </div>
            <div>
              <dt>{{ t.aiStop }}</dt>
              <dd>{{ fmt(trade?.stopLoss) }}</dd>
            </div>
            <div>
              <dt>{{ t.aiT1 }}</dt>
              <dd>{{ fmt(trade?.target1) }}</dd>
            </div>
            <div>
              <dt>{{ t.aiT2 }}</dt>
              <dd>{{ fmt(trade?.target2) }}</dd>
            </div>
          </dl>

          <dl class="indicator-grid">
            <div>
              <dt>{{ t.indTrend }}</dt>
              <dd>{{ trendLabel }}</dd>
            </div>
            <div>
              <dt>RSI</dt>
              <dd>{{ fmt(ind?.rsi, 1) }}</dd>
            </div>
            <div>
              <dt>MACD</dt>
              <dd>{{ fmt(ind?.macd, 4) }}</dd>
            </div>
            <div>
              <dt>{{ t.indMacdSignal }}</dt>
              <dd>{{ fmt(ind?.macdSignal, 4) }}</dd>
            </div>
            <div>
              <dt>{{ t.indMacdHist }}</dt>
              <dd>{{ fmt(ind?.macdHist, 4) }}</dd>
            </div>
            <div>
              <dt>{{ t.indSector }}</dt>
              <dd>{{ analysis.company?.sectorAr || analysis.company?.sectorEn || "—" }}</dd>
            </div>
            <div>
              <dt>{{ t.indRsMarket }}</dt>
              <dd>
                <template v-if="analysis.market?.rsVsMarket != null">
                  {{ analysis.market.rsVsMarket >= 0 ? "+" : "" }}{{ fmt(analysis.market.rsVsMarket, 1) }}%
                </template>
                <template v-else>—</template>
              </dd>
            </div>
            <div>
              <dt>{{ t.indLiquidity }}</dt>
              <dd>{{ analysis.market?.liquidityTier || analysis.considerations?.liquidity || "—" }}</dd>
            </div>
            <div>
              <dt>EMA 20</dt>
              <dd>{{ fmt(ind?.ema20) }}</dd>
            </div>
            <div>
              <dt>EMA 50</dt>
              <dd>{{ fmt(ind?.ema50) }}</dd>
            </div>
            <div>
              <dt>EMA 200</dt>
              <dd>{{ fmt(ind?.ema200) }}</dd>
            </div>
            <div>
              <dt>{{ t.indVolume }}</dt>
              <dd>{{ ind?.volumeRatio != null ? `${fmt(ind.volumeRatio, 1)}×` : "—" }}</dd>
            </div>
            <div>
              <dt>{{ t.indSupport }}</dt>
              <dd>{{ fmt(ind?.support) }}</dd>
            </div>
            <div>
              <dt>{{ t.indResistance }}</dt>
              <dd>{{ fmt(ind?.resistance) }}</dd>
            </div>
            <div>
              <dt>{{ t.indDistSup }}</dt>
              <dd>{{ ind?.distToSupportPct != null ? `${fmt(ind.distToSupportPct, 1)}%` : "—" }}</dd>
            </div>
            <div>
              <dt>{{ t.indDistRes }}</dt>
              <dd>{{ ind?.distToResistancePct != null ? `${fmt(ind.distToResistancePct, 1)}%` : "—" }}</dd>
            </div>
            <div>
              <dt>ATR</dt>
              <dd>
                {{ fmt(ind?.atr) }}
                <template v-if="ind?.atrPct != null"> ({{ fmt(ind.atrPct, 1) }}%)</template>
              </dd>
            </div>
            <div>
              <dt>{{ t.indMom5 }}</dt>
              <dd>{{ ind?.momentum5 != null ? `${fmt(ind.momentum5, 1)}%` : "—" }}</dd>
            </div>
            <div>
              <dt>{{ t.indRR }}</dt>
              <dd>{{ ind?.riskReward != null ? `${fmt(ind.riskReward, 2)}:1` : "—" }}</dd>
            </div>
            <div>
              <dt>{{ t.aiConfidence }}</dt>
              <dd>{{ analysis.score }}/100</dd>
            </div>
          </dl>

          <div v-if="signalLabels.length" class="signal-row">
            <span v-for="(label, i) in signalLabels" :key="i" class="signal-chip">{{ label }}</span>
          </div>

          <div class="reasons-block">
            <h3>{{ t.indReasons }}</h3>
            <ul>
              <li v-for="(reason, i) in analysis.reasons" :key="i">{{ reason }}</li>
            </ul>
          </div>

          <p class="ai-disclaimer">{{ t.aiDisclaimer }}</p>
        </template>
      </section>

      <section class="ai-panel">
        <div class="ai-head">
          <div>
            <h2>{{ t.aiTitle }}</h2>
            <p>{{ t.aiLede }}</p>
          </div>
          <button
            type="button"
            class="ai-btn"
            :disabled="suggesting"
            @click="askAi"
          >
            {{ suggesting ? t.aiLoading : t.aiCta }}
          </button>
        </div>

        <p v-if="suggestError" class="ai-error">{{ t.aiError }}: {{ suggestError }}</p>

        <div
          v-if="suggestion"
          class="ai-result"
          :class="suggestion.action"
        >
          <div class="ai-action">
            <span class="badge">{{ t.aiAction[suggestion.action] || suggestion.action }}</span>
            <span class="confidence">{{ t.aiConfidence }}: {{ suggestion.confidence }}/100</span>
          </div>
          <p class="ai-summary">{{ suggestion.summary }}</p>

          <div v-if="suggestion.considerations" class="ai-considerations">
            <h3 class="plan-title">{{ t.aiConsiderationsTitle }}</h3>
            <dl class="considerations-grid">
              <div
                v-for="(text, key) in suggestion.considerations"
                :key="key"
                :class="{ priority: ['valuation', 'earningsQuality', 'capitalAllocation'].includes(key) }"
              >
                <dt>{{ t.aiConsideration[key] || key }}</dt>
                <dd>{{ text }}</dd>
              </div>
            </dl>
          </div>

          <div v-if="suggestion.plans?.length" class="plan-table-wrap">
            <h3 class="plan-title">{{ t.aiPlansTitle }}</h3>
            <table class="plan-table">
              <thead>
                <tr>
                  <th>{{ t.aiPlanHorizon }}</th>
                  <th>{{ t.aiPlanBias }}</th>
                  <th>{{ t.aiPlanBuy }}</th>
                  <th>{{ t.aiPlanSell }}</th>
                  <th>{{ t.aiStop }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="plan in suggestion.plans" :key="plan.horizon" :class="plan.action">
                  <td>
                    <strong>{{ t.aiHorizon[plan.horizon] || plan.horizon }}</strong>
                    <span v-if="plan.note" class="plan-note">{{ plan.note }}</span>
                  </td>
                  <td>
                    <span class="badge plan-badge">{{ t.aiAction[plan.action] || plan.action }}</span>
                  </td>
                  <td class="num buy-px">{{ fmt(plan.buy) }}</td>
                  <td class="num sell-px">
                    {{ fmt(plan.sell) }}
                    <template v-if="plan.sell2 != null">
                      <span class="sell2"> / {{ fmt(plan.sell2) }}</span>
                    </template>
                  </td>
                  <td class="num">{{ fmt(plan.stop) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <dl v-else-if="suggestion.entry != null" class="pick-levels detail-levels">
            <div><dt>{{ t.aiEntry }}</dt><dd>{{ fmt(suggestion.entry) }}</dd></div>
            <div><dt>{{ t.aiStop }}</dt><dd>{{ fmt(suggestion.stopLoss) }}</dd></div>
            <div><dt>{{ t.aiT1 }}</dt><dd>{{ fmt(suggestion.target1) }}</dd></div>
            <div><dt>{{ t.aiT2 }}</dt><dd>{{ fmt(suggestion.target2) }}</dd></div>
          </dl>
          <ul v-if="suggestion.reasons?.length">
            <li v-for="(reason, i) in suggestion.reasons" :key="i">{{ reason }}</li>
          </ul>
          <div v-if="suggestion.signals?.length" class="ai-signals">
            <h3 class="plan-title">{{ t.aiSignalsTitle }}</h3>
            <div class="signal-row">
              <span v-for="(sig, i) in suggestion.signals" :key="i" class="signal-chip">{{ sig }}</span>
            </div>
          </div>
          <p class="ai-disclaimer">{{ t.aiDisclaimer }}</p>
        </div>
      </section>

      <CandleChart
        :quote="quote"
        :lang="lang"
        :locale="locale"
        :as-of-label="t.asOf"
        :hover-label="t.hover"
        :hint="t.hint(payload.range || '3mo')"
      />
    </template>
  </div>
</template>
