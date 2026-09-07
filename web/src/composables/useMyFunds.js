import { computed, reactive, watch } from "vue";
import { costFromCurrent, parseAmount, parsePct } from "../../../src/lib/thndrFunds.js";

const STORAGE_KEY = "egx-my-funds-v1";

function uid() {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => ({
        id: String(row.id || uid()),
        code: String(row.code || "").toUpperCase().trim(),
        name: String(row.name || "").trim(),
        amount: parseAmount(row.amount),
        pnlPct: parsePct(row.pnlPct),
      }))
      .filter((row) => row.code && Number.isFinite(row.amount) && (row.amount > 0 || row.name));
  } catch {
    return [];
  }
}

const holdings = reactive(load());

watch(
  holdings,
  (list) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  },
  { deep: true }
);

export function useMyFunds() {
  const totalValue = computed(() => holdings.reduce((s, h) => s + (Number(h.amount) || 0), 0));
  const totalAmount = computed(() =>
    holdings.reduce((s, h) => {
      const cost = costFromCurrent(h.amount, h.pnlPct);
      return s + (Number.isFinite(cost) ? cost : Number(h.amount) || 0);
    }, 0)
  );
  const totalPnl = computed(() => totalValue.value - totalAmount.value);
  const totalPnlPct = computed(() =>
    totalAmount.value ? (totalPnl.value / totalAmount.value) * 100 : 0
  );

  function upsert({ code, amount, pnlPct, name }) {
    const c = String(code || "").toUpperCase().trim();
    const a = parseAmount(amount);
    const p = parsePct(pnlPct);
    const label = String(name || "").trim();
    if (!c) return false;
    if (!Number.isFinite(a) || a < 0) return false;
    if (a === 0 && !label) return false;
    const pct = Number.isFinite(p) ? p : 0;
    const i = holdings.findIndex((h) => h.code === c);
    const row = {
      id: i >= 0 ? holdings[i].id : uid(),
      code: c,
      name: label || holdings[i]?.name || "",
      amount: a,
      pnlPct: pct,
    };
    if (i >= 0) holdings.splice(i, 1, row);
    else holdings.push(row);
    return true;
  }

  function replaceAll(rows) {
    holdings.splice(0, holdings.length);
    for (const row of rows || []) upsert(row);
  }

  function remove(id) {
    const i = holdings.findIndex((h) => h.id === id);
    if (i >= 0) holdings.splice(i, 1);
  }

  return { holdings, totalAmount, totalValue, totalPnl, totalPnlPct, upsert, replaceAll, remove };
}
