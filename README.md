# EGX Market

سحب سريع لأسعار/شموع البورصة المصرية عبر **Yahoo Finance API** (fetch موازي)، وعرضها بـ **Vue + Vite**.

## تشغيل

```bash
npm install
npm run scrape    # سحب مرة واحدة
npm run view      # http://localhost:5173
npm run watch     # سحب كل 10ث
```

## الهيكل

```
data/symbols.js     # قائمة الأسهم
src/scrape.js       # سحب موازي
src/watch.js        # تحديث دوري
src/lib/yahoo.js    # Yahoo fetch
web/                # Vue dashboard
```

الواجهة تعمل poll لـ `latest.json` كل 5 ثواني.

## Deploy (GitHub Pages + Render API)

### 1) API on Render (free)

1. Open [Render Blueprints](https://dashboard.render.com/blueprints) → **New Blueprint Instance**
2. Connect the `Beshoy2549/EGX` repo (uses `render.yaml`)
3. Fill secrets when prompted:
   - `OPENAI_API_KEY` (recommended for free tier)
   - or `CURSOR_API_KEY`
   - optional `REFRESH_SECRET` (protects `POST /api/refresh`)
4. Deploy → copy the service URL, e.g. `https://egx-api.onrender.com`
5. Check health: `https://egx-api.onrender.com/api/health`
   - Expect `marketReady: true` and a non-zero `market.quotes` count
   - Build runs `npm run scrape` so `web/public/latest.json` ships with the deploy
   - If the file is still missing at boot, the API scrapes once in the background and `/api/scan` returns **503** until ready
6. Optional manual refresh: `curl -X POST https://YOUR-SERVICE/api/refresh` (send `x-refresh-secret` if set)

Free Render services sleep after idle; the first request can take ~30–60s. The build scrape can take several minutes (Yahoo, full symbol list).

### 2) Frontend on GitHub Pages

1. Repo **Settings → Pages → Source: GitHub Actions**
2. The workflow scrapes (or copies `web/public/market-snapshot.json`) so `/EGX/latest.json` is in the build
3. Repo **Settings → Secrets and variables → Actions → Variables**
   - Add `VITE_API_BASE` = your Render URL (no trailing slash)
3. Push to `main` (or re-run **Deploy GitHub Pages**)
4. Site: `https://beshoy2549.github.io/EGX/`
5. Dev bypass: `https://beshoy2549.github.io/EGX/?devbypass=1`

Locally, leave `VITE_API_BASE` unset — Vite still proxies `/api` to `localhost:8787`.
