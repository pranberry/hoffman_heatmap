/**
 * fetch-data.ts
 *
 * Standalone Node.js script that fetches heatmap data from Yahoo Finance
 * and writes static JSON files for the web app to consume.
 *
 * Run: npx tsx scripts/fetch-data.ts
 *
 * Outputs:
 *   public/data/tsx.json
 *   public/data/sp500.json
 *   public/data/nasdaq.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// ── Types ──────────────────────────────────────────────────────────────────────

interface Holding {
  ticker: string;
  yahooTicker: string;
  name: string;
  sector: string;
  weight: number;
  mcapHint: number;
}

interface StockData {
  ticker: string;
  name: string;
  price: number;
  mcap: number;
  weight: number;
  changeDay: number;
  changeMonth: number;
  changeYear: number;
}

interface SectorData {
  name: string;
  stocks: StockData[];
}

interface HeatmapJSON {
  lastUpdated: string;
  tickerCount: number;
  sectors: SectorData[];
  isMarketOpen?: boolean;
}

// ── Yahoo Finance ──────────────────────────────────────────────────────────────

let _yf: any;
async function getYF() {
  if (!_yf) {
    const mod = await import('yahoo-finance2');
    const YF = mod.default;
    _yf = typeof YF === 'function' ? new (YF as any)({ suppressNotices: ['yahooSurvey'] }) : YF;
  }
  return _yf;
}

async function fetchStock(h: Holding): Promise<StockData | null> {
  try {
    const yf = await getYF();
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const [quote, history] = await Promise.all([
      yf.quote(h.yahooTicker),
      yf.chart(h.yahooTicker, {
        period1: oneYearAgo.toISOString().split('T')[0],
        interval: '1d',
      }).catch(() => null),
    ]);

    const price     = quote.regularMarketPrice ?? 0;
    const prevClose = quote.regularMarketPreviousClose ?? price;
    const changeDay = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
    const mcap      = (quote.marketCap ?? 0) / 1e9;

    let changeMonth = 0;
    let changeYear  = 0;

    if (history?.quotes?.length) {
      const quotes = history.quotes.filter((q: any) => q.close != null);
      if (quotes.length > 0) {
        changeYear = quotes[0].close ? ((price - quotes[0].close) / quotes[0].close) * 100 : 0;

        const oneMonthAgo = new Date(now);
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        const monthTarget = oneMonthAgo.getTime();
        let best = quotes[0];
        let bestDiff = Infinity;
        for (const q of quotes) {
          const diff = Math.abs(new Date(q.date).getTime() - monthTarget);
          if (diff < bestDiff) { bestDiff = diff; best = q; }
        }
        changeMonth = best.close ? ((price - best.close) / best.close) * 100 : 0;
      }
    }

    return {
      ticker:      h.ticker,
      name:        h.name,
      price:       Math.round(price * 100) / 100,
      mcap:        Math.round(mcap * 100) / 100,
      weight:      h.weight,
      changeDay:   Math.round(changeDay * 100) / 100,
      changeMonth: Math.round(changeMonth * 100) / 100,
      changeYear:  Math.round(changeYear * 100) / 100,
    };
  } catch (e) {
    console.error(`  FAIL ${h.yahooTicker}: ${(e as Error).message}`);
    return null;
  }
}

async function fetchAll(holdings: Holding[], concurrency = 15): Promise<StockData[]> {
  const results: StockData[] = [];
  let idx = 0;

  async function worker() {
    while (idx < holdings.length) {
      const i = idx++;
      const res = await fetchStock(holdings[i]);
      if (res) results.push(res);
      if (idx % 50 === 0) console.log(`  ... ${idx}/${holdings.length}`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, holdings.length) }, () => worker()));
  return results;
}

function groupBySector(stocks: StockData[], holdings: Holding[]): SectorData[] {
  const sectorMap = new Map<string, string>();
  for (const h of holdings) sectorMap.set(h.ticker, h.sector);

  const sectors = new Map<string, StockData[]>();
  for (const s of stocks) {
    const sector = sectorMap.get(s.ticker) || 'Unknown';
    if (!sectors.has(sector)) sectors.set(sector, []);
    sectors.get(sector)!.push(s);
  }

  return Array.from(sectors.entries())
    .map(([name, sectorStocks]) => ({
      name,
      stocks: sectorStocks.sort((a, b) => b.mcap - a.mcap),
    }))
    .sort((a, b) => {
      const totA = a.stocks.reduce((s, st) => s + st.mcap, 0);
      const totB = b.stocks.reduce((s, st) => s + st.mcap, 0);
      return totB - totA;
    });
}

// ── Market Hours ──────────────────────────────────────────────────────────────

function isMarketOpen(timezone: string, holidays: { m: number; d: number }[]): boolean {
  const now = new Date();
  const d = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const day = d.getDay();
  if (day === 0 || day === 6) return false;

  const totalMin = d.getHours() * 60 + d.getMinutes();
  if (totalMin < 9 * 60 + 30 || totalMin >= 16 * 60) return false;

  const mo = d.getMonth() + 1;
  const dd = d.getDate();
  return !holidays.some(h => h.m === mo && h.d === dd);
}

const US_HOLIDAYS = [
  { m: 1, d: 1 }, { m: 1, d: 19 }, { m: 2, d: 16 }, { m: 4, d: 3 },
  { m: 5, d: 25 }, { m: 6, d: 19 }, { m: 7, d: 3 }, { m: 9, d: 7 },
  { m: 11, d: 26 }, { m: 12, d: 25 },
];

const CA_HOLIDAYS = [
  { m: 1, d: 1 }, { m: 2, d: 16 }, { m: 4, d: 3 }, { m: 5, d: 18 },
  { m: 7, d: 1 }, { m: 8, d: 3 }, { m: 9, d: 7 }, { m: 10, d: 12 },
  { m: 12, d: 25 }, { m: 12, d: 28 },
];

function formatTimestamp(tz: string): string {
  return new Date().toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    timeZoneName: 'short', timeZone: tz,
  });
}

// ── ETF Holdings Loaders (BlackRock iShares CSVs) ─────────────────────────────

function titleCase(s: string): string {
  return s.toLowerCase().split(' ').map(w => w.length ? w[0].toUpperCase() + w.slice(1) : '').join(' ');
}

type TickerNormalizer = (raw: string) => { display: string; yahoo: string } | null;

const normalizeTSX: TickerNormalizer = raw => {
  const t = raw.trim().replace(/"/g, '');
  if (!t || /^\d+[A-Z]*$/.test(t)) return null;
  return { display: t, yahoo: t.replace(/\./g, '-') + '.TO' };
};

const normalizeUS: TickerNormalizer = raw => {
  const t = raw.trim().replace(/"/g, '');
  if (!t || /^\d/.test(t)) return null;
  // Yahoo uses '-' where index publishers use '.' (e.g. BRK.B → BRK-B)
  return { display: t, yahoo: t.replace(/\./g, '-') };
};

interface BlackRockHoldingsSource {
  label:          string;
  url:            string;
  fallbackPath:   string;
  normalize:      TickerNormalizer;
}

async function loadBlackRockHoldings(src: BlackRockHoldingsSource): Promise<Holding[]> {
  let csvText: string;
  try {
    console.log(`Fetching ${src.label} holdings from BlackRock...`);
    const resp = await fetch(src.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    csvText = await resp.text();
  } catch (e) {
    console.log(`BlackRock fetch failed for ${src.label}, using local CSV...`);
    csvText = fs.readFileSync(src.fallbackPath, 'utf-8');
  }

  const lines = csvText.split('\n');
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (lines[i].includes('Ticker') && lines[i].includes('Name') && lines[i].includes('Sector')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) throw new Error(`${src.label}: could not find CSV header`);

  const parsed = parse(lines.slice(headerIdx).join('\n'), {
    columns: true, skip_empty_lines: true, relax_column_count: true, trim: true,
  });

  const holdings: Holding[] = [];
  for (const row of parsed as Record<string, string>[]) {
    if ((row['Asset Class'] || '').trim() !== 'Equity') continue;
    const rawTicker = (row['Ticker'] || '').trim();
    if (!rawTicker) continue;
    const norm = src.normalize(rawTicker);
    if (!norm) continue;
    holdings.push({
      ticker:      norm.display,
      yahooTicker: norm.yahoo,
      name:        titleCase(row['Name'] || ''),
      sector:      (row['Sector'] || 'Unknown').trim(),
      weight:      parseFloat((row['Weight (%)'] || '0').replace(/,/g, '')) || 0,
      mcapHint:    0,
    });
  }
  return holdings;
}

const RESOURCES_DIR = path.join(__dirname, '..', '..', 'resources');

const XIC_SOURCE: BlackRockHoldingsSource = {
  label:        'XIC (S&P/TSX)',
  url:          'https://www.blackrock.com/ca/investors/en/products/239837/ishares-sptsx-capped-composite-index-etf/1545043.ajax?tab=holdings&fileType=csv',
  fallbackPath: path.join(RESOURCES_DIR, 'XIC_holdings.csv'),
  normalize:    normalizeTSX,
};

const IVV_SOURCE: BlackRockHoldingsSource = {
  label:        'IVV (S&P 500)',
  url:          'https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf/1467271812596.ajax?fileType=csv&fileName=IVV_holdings&dataType=fund',
  fallbackPath: path.join(RESOURCES_DIR, 'IVV_holdings.csv'),
  normalize:    normalizeUS,
};

// ── NASDAQ-100 Holdings (from NASDAQ's own API) ──────────────────────────────
//
// BlackRock has no NASDAQ-100 ETF in the US; Invesco QQQ doesn't expose a
// stable CSV. NASDAQ publishes the index composition directly as JSON. The
// payload gives tickers, names, and market caps but no sectors, so we layer
// sectors from IVV (S&P 500 overlap) and a small overlay for NDX-only names.

const NDX_SECTOR_OVERLAY: Record<string, string> = {
  ASML: 'Information Technology',
  ARM:  'Information Technology',
  SNDK: 'Information Technology',
  PDD:  'Consumer Discretionary',
  MELI: 'Consumer Discretionary',
  JD:   'Consumer Discretionary',
  BIDU: 'Communication Services',
  TCOM: 'Consumer Discretionary',
  TRI:  'Industrials',
  FER:  'Industrials',
  CCEP: 'Consumer Staples',
};

async function loadNASDAQ100Holdings(sp500: Holding[]): Promise<Holding[]> {
  const sectorByTicker = new Map<string, string>();
  for (const h of sp500) sectorByTicker.set(h.ticker, h.sector);

  let rows: Array<{ symbol: string; companyName: string; marketCap: string }>;
  try {
    console.log('Fetching NASDAQ-100 composition from NASDAQ API...');
    const resp = await fetch('https://api.nasdaq.com/api/quote/list-type/nasdaq100', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json() as any;
    rows = json?.data?.data?.rows || [];
    if (!rows.length) throw new Error('empty rows');
  } catch (e) {
    console.log(`NASDAQ API failed (${(e as Error).message}), using local fallback...`);
    const raw = fs.readFileSync(path.join(RESOURCES_DIR, 'NDX_holdings.json'), 'utf-8');
    rows = JSON.parse(raw);
  }

  // Compute total market cap for weight calculation
  const parsed = rows
    .map(r => ({
      ticker: r.symbol.trim(),
      name:   titleCase((r.companyName || '').replace(/\s+Common Stock.*$/i, '').replace(/\s+Class [A-Z].*$/i, '')),
      mcap:   parseFloat((r.marketCap || '0').replace(/,/g, '')) || 0,
    }))
    .filter(r => r.ticker && r.mcap > 0);

  const totalMcap = parsed.reduce((s, r) => s + r.mcap, 0);

  return parsed.map(r => {
    const norm = normalizeUS(r.ticker)!;
    return {
      ticker:      norm.display,
      yahooTicker: norm.yahoo,
      name:        r.name,
      sector:      sectorByTicker.get(norm.display) || NDX_SECTOR_OVERLAY[norm.display] || 'Unknown',
      weight:      totalMcap > 0 ? Math.round((r.mcap / totalMcap) * 100 * 100) / 100 : 0,
      mcapHint:    r.mcap / 1e9,
    };
  });
}


// ── Dedup helper (S&P 500 and NASDAQ share some tickers) ─────────────────────

function dedup(holdings: Holding[]): { ticker: string; yahooTicker: string }[] {
  const seen = new Set<string>();
  const result: { ticker: string; yahooTicker: string }[] = [];
  for (const h of holdings) {
    if (!seen.has(h.yahooTicker)) {
      seen.add(h.yahooTicker);
      result.push({ ticker: h.ticker, yahooTicker: h.yahooTicker });
    }
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function buildIndex(
  label: string,
  holdings: Holding[],
  sharedResults: Map<string, StockData>,
  timezone: string,
  holidays: { m: number; d: number }[],
): Promise<HeatmapJSON> {
  console.log(`\n[${label}] Building from ${holdings.length} holdings...`);

  const stocks: StockData[] = [];
  for (const h of holdings) {
    const cached = sharedResults.get(h.yahooTicker);
    if (cached) {
      // Use the weight from this specific index (not the shared fetch)
      stocks.push({ ...cached, weight: h.weight, name: h.name });
    }
  }

  const sectors = groupBySector(stocks, holdings);
  return {
    lastUpdated: formatTimestamp(timezone),
    tickerCount: stocks.length,
    sectors,
    isMarketOpen: isMarketOpen(timezone, holidays),
  };
}

async function main() {
  console.log('=== Hoffman Heatmap Data Fetch ===');
  console.log(`Time: ${new Date().toISOString()}`);

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Load holdings from live ETF/index sources (with on-disk fallbacks)
  const tsxHoldings    = await loadBlackRockHoldings(XIC_SOURCE);
  console.log(`TSX:    ${tsxHoldings.length} holdings`);

  const sp500Holdings  = await loadBlackRockHoldings(IVV_SOURCE);
  console.log(`S&P:    ${sp500Holdings.length} holdings`);

  const nasdaqHoldings = await loadNASDAQ100Holdings(sp500Holdings);
  console.log(`NDX:    ${nasdaqHoldings.length} holdings`);

  const allHoldings = [...tsxHoldings, ...sp500Holdings, ...nasdaqHoldings];
  const uniqueTickers = dedup(allHoldings);
  console.log(`Total unique tickers to fetch: ${uniqueTickers.length}`);

  // Fetch all unique tickers once
  const holdingsForFetch: Holding[] = uniqueTickers.map(t => ({
    ticker: t.ticker,
    yahooTicker: t.yahooTicker,
    name: '', sector: '', weight: 0, mcapHint: 0,
  }));

  console.log('\nFetching quotes from Yahoo Finance...');
  const allStocks = await fetchAll(holdingsForFetch);
  console.log(`Fetched ${allStocks.length}/${uniqueTickers.length} successfully`);

  // Index results by Yahoo ticker for fast lookup
  const resultMap = new Map<string, StockData>();
  for (const s of allStocks) {
    // Find the yahooTicker for this result
    const match = uniqueTickers.find(t => t.ticker === s.ticker);
    if (match) resultMap.set(match.yahooTicker, s);
  }

  // Build and write each index
  const tsx    = await buildIndex('TSX',        tsxHoldings,    resultMap, 'America/Toronto',  CA_HOLIDAYS);
  const sp500  = await buildIndex('S&P 500',    sp500Holdings,  resultMap, 'America/New_York', US_HOLIDAYS);
  const nasdaq = await buildIndex('NASDAQ-100', nasdaqHoldings, resultMap, 'America/New_York', US_HOLIDAYS);

  fs.writeFileSync(path.join(DATA_DIR, 'tsx.json'), JSON.stringify(tsx));
  fs.writeFileSync(path.join(DATA_DIR, 'sp500.json'), JSON.stringify(sp500));
  fs.writeFileSync(path.join(DATA_DIR, 'nasdaq.json'), JSON.stringify(nasdaq));

  console.log(`\nDone! Wrote:`);
  console.log(`  tsx.json    — ${tsx.tickerCount} stocks`);
  console.log(`  sp500.json  — ${sp500.tickerCount} stocks`);
  console.log(`  nasdaq.json — ${nasdaq.tickerCount} stocks`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
