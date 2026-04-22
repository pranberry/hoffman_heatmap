# Hoffman Heatmap

Static browser heatmap for TSX, S&P 500, and NASDAQ-100. No backend — data is pre-computed every 15 minutes by GitHub Actions and committed as static JSON, then served via GitHub Pages.

View Live: https://pranberry.github.io/hoffman_heatmap/

![TSX stocks](https://img.shields.io/badge/TSX%20stocks-222-green) ![S&P 500](https://img.shields.io/badge/S%26P%20500-500%2B-blue) ![NASDAQ-100](https://img.shields.io/badge/NASDAQ--100-100-blue)</br>
<img src="./screenshots/screenshot_heatmap.png" alt="screenshot_heatmap" width="500"/>


## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4
- D3.js treemap
- Yahoo Finance (via `yahoo-finance2`) fetched in CI

## Layout

```
web/                   Vite app (build → web/dist)
  src/                 React source
  public/data/*.json   Committed heatmap data (tsx, sp500, nasdaq)
  scripts/fetch-data.ts  CI data fetcher
.github/workflows/
  heatmap-data.yml     Cron: fetch Yahoo Finance, commit if changed
  deploy-web.yml       Build web/ and deploy to Pages
resources/
  XIC_holdings.csv     BlackRock TSX holdings (local fallback)
```

## Develop and Run Locally

```bash
cd web
npm install
npm run dev            # local dev server
npm run build          # type-check + production build
npm run fetch-data     # refresh public/data/*.json
```
