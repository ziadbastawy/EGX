/**
 * Backend base URL.
 *
 * Build time (GitHub Pages): set Actions variable/secret VITE_API_BASE
 *   e.g. https://your-service.onrender.com
 * Runtime override: Settings → API URL (saved in localStorage)
 * Local dev: leave empty so Vite proxies /api → localhost:8787
 */
const STORAGE_KEY = "egx_api_base";

function normalizeBase(raw) {
  return String(raw || "")
    .trim()
    .replace(/\/$/, "");
}

export function getApiBase() {
  try {
    const stored = normalizeBase(localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  return normalizeBase(import.meta.env.VITE_API_BASE);
}

export function setApiBase(url) {
  const next = normalizeBase(url);
  try {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return next;
}

export function apiUrl(path) {
  const base = getApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/**
 * Static files from web/public (latest.json, fundamentals.json).
 * Must include Vite BASE_URL so GitHub Pages serves /EGX/latest.json
 * instead of github.io/latest.json.
 */
export function publicUrl(path) {
  const base = String(import.meta.env.BASE_URL || "/");
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const p = String(path || "").replace(/^\//, "");
  return `${prefix}${p}`;
}
