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

// ── TSX Holdings (from BlackRock CSV) ────────────────────────────────────────

const BLACKROCK_CSV_URL =
  'https://www.blackrock.com/ca/investors/en/products/239837/ishares-sptsx-capped-composite-index-etf/1545043.ajax?tab=holdings&fileType=csv';

function normalizeTicker(raw: string): { display: string; yahoo: string } {
  const t = raw.trim().replace(/"/g, '');
  if (/^\d+[A-Z]*$/.test(t)) return { display: t, yahoo: '' };
  return { display: t, yahoo: t.replace(/\./g, '-') + '.TO' };
}

function titleCase(s: string): string {
  return s.toLowerCase().split(' ').map(w => w.length ? w[0].toUpperCase() + w.slice(1) : '').join(' ');
}

async function loadTSXHoldings(): Promise<Holding[]> {
  let csvText: string;
  try {
    console.log('Fetching XIC holdings from BlackRock...');
    const resp = await fetch(BLACKROCK_CSV_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    csvText = await resp.text();
  } catch (e) {
    console.log('BlackRock fetch failed, using local CSV...');
    csvText = fs.readFileSync(path.join(__dirname, '..', '..', 'resources', 'XIC_holdings.csv'), 'utf-8');
  }

  const lines = csvText.split('\n');
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (lines[i].includes('Ticker') && lines[i].includes('Name') && lines[i].includes('Sector')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) throw new Error('Could not find CSV header');

  const parsed = parse(lines.slice(headerIdx).join('\n'), {
    columns: true, skip_empty_lines: true, relax_column_count: true, trim: true,
  });

  const holdings: Holding[] = [];
  for (const row of parsed as Record<string, string>[]) {
    if ((row['Asset Class'] || '').trim() !== 'Equity') continue;
    const rawTicker = (row['Ticker'] || '').trim();
    if (!rawTicker) continue;
    const { display, yahoo } = normalizeTicker(rawTicker);
    if (!yahoo) continue;
    holdings.push({
      ticker: display,
      yahooTicker: yahoo,
      name: titleCase(row['Name'] || ''),
      sector: (row['Sector'] || 'Unknown').trim(),
      weight: parseFloat((row['Weight (%)'] || '0').replace(/,/g, '')) || 0,
      mcapHint: 0,
    });
  }
  return holdings;
}

// ── US Holdings (static) ──────────────────────────────────────────────────────

const NASDAQ100_HOLDINGS: Holding[] = [
  { ticker: 'MSFT',  yahooTicker: 'MSFT',  name: 'Microsoft',              sector: 'Information Technology', weight: 8.5,  mcapHint: 3100 },
  { ticker: 'AAPL',  yahooTicker: 'AAPL',  name: 'Apple',                  sector: 'Information Technology', weight: 8.2,  mcapHint: 3300 },
  { ticker: 'NVDA',  yahooTicker: 'NVDA',  name: 'NVIDIA',                 sector: 'Information Technology', weight: 7.1,  mcapHint: 2600 },
  { ticker: 'AVGO',  yahooTicker: 'AVGO',  name: 'Broadcom',               sector: 'Information Technology', weight: 4.2,  mcapHint: 940  },
  { ticker: 'AMD',   yahooTicker: 'AMD',   name: 'Advanced Micro Devices', sector: 'Information Technology', weight: 1.4,  mcapHint: 230  },
  { ticker: 'QCOM',  yahooTicker: 'QCOM',  name: 'Qualcomm',               sector: 'Information Technology', weight: 1.3,  mcapHint: 180  },
  { ticker: 'INTU',  yahooTicker: 'INTU',  name: 'Intuit',                 sector: 'Information Technology', weight: 1.2,  mcapHint: 180  },
  { ticker: 'AMAT',  yahooTicker: 'AMAT',  name: 'Applied Materials',      sector: 'Information Technology', weight: 1.2,  mcapHint: 155  },
  { ticker: 'TXN',   yahooTicker: 'TXN',   name: 'Texas Instruments',      sector: 'Information Technology', weight: 1.0,  mcapHint: 165  },
  { ticker: 'ADI',   yahooTicker: 'ADI',   name: 'Analog Devices',         sector: 'Information Technology', weight: 0.7,  mcapHint: 110  },
  { ticker: 'CSCO',  yahooTicker: 'CSCO',  name: 'Cisco Systems',          sector: 'Information Technology', weight: 1.1,  mcapHint: 220  },
  { ticker: 'LRCX',  yahooTicker: 'LRCX',  name: 'Lam Research',           sector: 'Information Technology', weight: 0.65, mcapHint: 95   },
  { ticker: 'KLAC',  yahooTicker: 'KLAC',  name: 'KLA Corp',               sector: 'Information Technology', weight: 0.6,  mcapHint: 85   },
  { ticker: 'CDNS',  yahooTicker: 'CDNS',  name: 'Cadence Design Systems', sector: 'Information Technology', weight: 0.6,  mcapHint: 80   },
  { ticker: 'SNPS',  yahooTicker: 'SNPS',  name: 'Synopsys',               sector: 'Information Technology', weight: 0.6,  mcapHint: 78   },
  { ticker: 'MRVL',  yahooTicker: 'MRVL',  name: 'Marvell Technology',     sector: 'Information Technology', weight: 0.55, mcapHint: 65   },
  { ticker: 'PANW',  yahooTicker: 'PANW',  name: 'Palo Alto Networks',     sector: 'Information Technology', weight: 0.7,  mcapHint: 110  },
  { ticker: 'FTNT',  yahooTicker: 'FTNT',  name: 'Fortinet',               sector: 'Information Technology', weight: 0.55, mcapHint: 72   },
  { ticker: 'MU',    yahooTicker: 'MU',    name: 'Micron Technology',      sector: 'Information Technology', weight: 0.65, mcapHint: 95   },
  { ticker: 'NXPI',  yahooTicker: 'NXPI',  name: 'NXP Semiconductors',     sector: 'Information Technology', weight: 0.45, mcapHint: 54   },
  { ticker: 'MCHP',  yahooTicker: 'MCHP',  name: 'Microchip Technology',   sector: 'Information Technology', weight: 0.45, mcapHint: 50   },
  { ticker: 'ON',    yahooTicker: 'ON',    name: 'ON Semiconductor',       sector: 'Information Technology', weight: 0.3,  mcapHint: 38   },
  { ticker: 'ADP',   yahooTicker: 'ADP',   name: 'Automatic Data Processing', sector: 'Information Technology', weight: 0.75, mcapHint: 120 },
  { ticker: 'PAYX',  yahooTicker: 'PAYX',  name: 'Paychex',                sector: 'Information Technology', weight: 0.45, mcapHint: 55   },
  { ticker: 'ADSK',  yahooTicker: 'ADSK',  name: 'Autodesk',               sector: 'Information Technology', weight: 0.35, mcapHint: 56   },
  { ticker: 'CRWD',  yahooTicker: 'CRWD',  name: 'CrowdStrike',            sector: 'Information Technology', weight: 0.3,  mcapHint: 90   },
  { ticker: 'ZS',    yahooTicker: 'ZS',    name: 'Zscaler',                sector: 'Information Technology', weight: 0.25, mcapHint: 38   },
  { ticker: 'DDOG',  yahooTicker: 'DDOG',  name: 'Datadog',                sector: 'Information Technology', weight: 0.25, mcapHint: 45   },
  { ticker: 'WDAY',  yahooTicker: 'WDAY',  name: 'Workday',                sector: 'Information Technology', weight: 0.3,  mcapHint: 56   },
  { ticker: 'TEAM',  yahooTicker: 'TEAM',  name: 'Atlassian',              sector: 'Information Technology', weight: 0.25, mcapHint: 48   },
  { ticker: 'ANSS',  yahooTicker: 'ANSS',  name: 'Ansys',                  sector: 'Information Technology', weight: 0.25, mcapHint: 30   },
  { ticker: 'CTSH',  yahooTicker: 'CTSH',  name: 'Cognizant Technology',   sector: 'Information Technology', weight: 0.3,  mcapHint: 35   },
  { ticker: 'INTC',  yahooTicker: 'INTC',  name: 'Intel',                  sector: 'Information Technology', weight: 0.4,  mcapHint: 78   },
  { ticker: 'ROP',   yahooTicker: 'ROP',   name: 'Roper Technologies',     sector: 'Information Technology', weight: 0.3,  mcapHint: 60   },
  { ticker: 'SMCI',  yahooTicker: 'SMCI',  name: 'Super Micro Computer',   sector: 'Information Technology', weight: 0.2,  mcapHint: 35   },
  { ticker: 'ARM',   yahooTicker: 'ARM',   name: 'Arm Holdings',           sector: 'Information Technology', weight: 0.5,  mcapHint: 130  },
  { ticker: 'ASML',  yahooTicker: 'ASML',  name: 'ASML Holding',           sector: 'Information Technology', weight: 0.5,  mcapHint: 290  },
  { ticker: 'ENPH',  yahooTicker: 'ENPH',  name: 'Enphase Energy',         sector: 'Information Technology', weight: 0.15, mcapHint: 12   },
  { ticker: 'META',  yahooTicker: 'META',  name: 'Meta Platforms',         sector: 'Communication Services', weight: 4.8,  mcapHint: 1550 },
  { ticker: 'GOOGL', yahooTicker: 'GOOGL', name: 'Alphabet Class A',       sector: 'Communication Services', weight: 2.8,  mcapHint: 880  },
  { ticker: 'GOOG',  yahooTicker: 'GOOG',  name: 'Alphabet Class C',       sector: 'Communication Services', weight: 2.6,  mcapHint: 820  },
  { ticker: 'NFLX',  yahooTicker: 'NFLX',  name: 'Netflix',                sector: 'Communication Services', weight: 1.8,  mcapHint: 380  },
  { ticker: 'TMUS',  yahooTicker: 'TMUS',  name: 'T-Mobile US',            sector: 'Communication Services', weight: 1.5,  mcapHint: 270  },
  { ticker: 'WBD',   yahooTicker: 'WBD',   name: 'Warner Bros Discovery',  sector: 'Communication Services', weight: 0.25, mcapHint: 18   },
  { ticker: 'TTD',   yahooTicker: 'TTD',   name: 'The Trade Desk',         sector: 'Communication Services', weight: 0.2,  mcapHint: 42   },
  { ticker: 'EA',    yahooTicker: 'EA',    name: 'Electronic Arts',        sector: 'Communication Services', weight: 0.2,  mcapHint: 35   },
  { ticker: 'CHTR',  yahooTicker: 'CHTR',  name: 'Charter Communications', sector: 'Communication Services', weight: 0.25, mcapHint: 42   },
  { ticker: 'SIRI',  yahooTicker: 'SIRI',  name: 'Sirius XM',              sector: 'Communication Services', weight: 0.1,  mcapHint: 9    },
  { ticker: 'AMZN',  yahooTicker: 'AMZN',  name: 'Amazon',                 sector: 'Consumer Discretionary', weight: 5.2,  mcapHint: 2200 },
  { ticker: 'TSLA',  yahooTicker: 'TSLA',  name: 'Tesla',                  sector: 'Consumer Discretionary', weight: 3.1,  mcapHint: 1100 },
  { ticker: 'BKNG',  yahooTicker: 'BKNG',  name: 'Booking Holdings',       sector: 'Consumer Discretionary', weight: 0.9,  mcapHint: 170  },
  { ticker: 'ORLY',  yahooTicker: 'ORLY',  name: "O'Reilly Automotive",    sector: 'Consumer Discretionary', weight: 0.55, mcapHint: 72   },
  { ticker: 'SBUX',  yahooTicker: 'SBUX',  name: 'Starbucks',              sector: 'Consumer Discretionary', weight: 0.75, mcapHint: 95   },
  { ticker: 'MAR',   yahooTicker: 'MAR',   name: 'Marriott International', sector: 'Consumer Discretionary', weight: 0.5,  mcapHint: 75   },
  { ticker: 'MELI',  yahooTicker: 'MELI',  name: 'MercadoLibre',           sector: 'Consumer Discretionary', weight: 0.4,  mcapHint: 90   },
  { ticker: 'CPRT',  yahooTicker: 'CPRT',  name: 'Copart',                 sector: 'Consumer Discretionary', weight: 0.4,  mcapHint: 58   },
  { ticker: 'DLTR',  yahooTicker: 'DLTR',  name: 'Dollar Tree',            sector: 'Consumer Discretionary', weight: 0.25, mcapHint: 30   },
  { ticker: 'ROST',  yahooTicker: 'ROST',  name: 'Ross Stores',            sector: 'Consumer Discretionary', weight: 0.3,  mcapHint: 47   },
  { ticker: 'PCAR',  yahooTicker: 'PCAR',  name: 'PACCAR',                 sector: 'Consumer Discretionary', weight: 0.4,  mcapHint: 58   },
  { ticker: 'EBAY',  yahooTicker: 'EBAY',  name: 'eBay',                   sector: 'Consumer Discretionary', weight: 0.2,  mcapHint: 28   },
  { ticker: 'ABNB',  yahooTicker: 'ABNB',  name: 'Airbnb',                 sector: 'Consumer Discretionary', weight: 0.35, mcapHint: 82   },
  { ticker: 'TTWO',  yahooTicker: 'TTWO',  name: 'Take-Two Interactive',   sector: 'Consumer Discretionary', weight: 0.2,  mcapHint: 30   },
  { ticker: 'COST',  yahooTicker: 'COST',  name: 'Costco',                 sector: 'Consumer Staples',       weight: 2.5,  mcapHint: 430  },
  { ticker: 'PEP',   yahooTicker: 'PEP',   name: 'PepsiCo',                sector: 'Consumer Staples',       weight: 1.1,  mcapHint: 195  },
  { ticker: 'MDLZ',  yahooTicker: 'MDLZ',  name: 'Mondelez International', sector: 'Consumer Staples',       weight: 0.65, mcapHint: 87   },
  { ticker: 'KDP',   yahooTicker: 'KDP',   name: 'Keurig Dr Pepper',       sector: 'Consumer Staples',       weight: 0.4,  mcapHint: 46   },
  { ticker: 'MNST',  yahooTicker: 'MNST',  name: 'Monster Beverage',       sector: 'Consumer Staples',       weight: 0.3,  mcapHint: 52   },
  { ticker: 'AMGN',  yahooTicker: 'AMGN',  name: 'Amgen',                  sector: 'Health Care',            weight: 1.0,  mcapHint: 155  },
  { ticker: 'ISRG',  yahooTicker: 'ISRG',  name: 'Intuitive Surgical',     sector: 'Health Care',            weight: 0.9,  mcapHint: 195  },
  { ticker: 'GILD',  yahooTicker: 'GILD',  name: 'Gilead Sciences',        sector: 'Health Care',            weight: 0.75, mcapHint: 115  },
  { ticker: 'REGN',  yahooTicker: 'REGN',  name: 'Regeneron',              sector: 'Health Care',            weight: 0.7,  mcapHint: 115  },
  { ticker: 'BIIB',  yahooTicker: 'BIIB',  name: 'Biogen',                 sector: 'Health Care',            weight: 0.25, mcapHint: 26   },
  { ticker: 'DXCM',  yahooTicker: 'DXCM',  name: 'Dexcom',                 sector: 'Health Care',            weight: 0.35, mcapHint: 35   },
  { ticker: 'MRNA',  yahooTicker: 'MRNA',  name: 'Moderna',                sector: 'Health Care',            weight: 0.3,  mcapHint: 20   },
  { ticker: 'IDXX',  yahooTicker: 'IDXX',  name: 'IDEXX Laboratories',     sector: 'Health Care',            weight: 0.2,  mcapHint: 38   },
  { ticker: 'GEHC',  yahooTicker: 'GEHC',  name: 'GE HealthCare',          sector: 'Health Care',            weight: 0.25, mcapHint: 30   },
  { ticker: 'ILMN',  yahooTicker: 'ILMN',  name: 'Illumina',               sector: 'Health Care',            weight: 0.15, mcapHint: 14   },
  { ticker: 'ALGN',  yahooTicker: 'ALGN',  name: 'Align Technology',       sector: 'Health Care',            weight: 0.15, mcapHint: 14   },
  { ticker: 'HON',   yahooTicker: 'HON',   name: 'Honeywell',              sector: 'Industrials',            weight: 0.95, mcapHint: 130  },
  { ticker: 'CTAS',  yahooTicker: 'CTAS',  name: 'Cintas',                 sector: 'Industrials',            weight: 0.45, mcapHint: 82   },
  { ticker: 'ODFL',  yahooTicker: 'ODFL',  name: 'Old Dominion Freight',   sector: 'Industrials',            weight: 0.35, mcapHint: 42   },
  { ticker: 'VRSK',  yahooTicker: 'VRSK',  name: 'Verisk Analytics',       sector: 'Industrials',            weight: 0.3,  mcapHint: 42   },
  { ticker: 'FAST',  yahooTicker: 'FAST',  name: 'Fastenal',               sector: 'Industrials',            weight: 0.35, mcapHint: 45   },
  { ticker: 'CSX',   yahooTicker: 'CSX',   name: 'CSX Corp',               sector: 'Industrials',            weight: 0.35, mcapHint: 50   },
  { ticker: 'CEG',   yahooTicker: 'CEG',   name: 'Constellation Energy',   sector: 'Utilities',              weight: 0.4,  mcapHint: 72   },
  { ticker: 'AEP',   yahooTicker: 'AEP',   name: 'American Electric Power',sector: 'Utilities',              weight: 0.3,  mcapHint: 44   },
  { ticker: 'XEL',   yahooTicker: 'XEL',   name: 'Xcel Energy',            sector: 'Utilities',              weight: 0.2,  mcapHint: 28   },
  { ticker: 'EXC',   yahooTicker: 'EXC',   name: 'Exelon',                 sector: 'Utilities',              weight: 0.2,  mcapHint: 32   },
  { ticker: 'FANG',  yahooTicker: 'FANG',  name: 'Diamondback Energy',     sector: 'Energy',                 weight: 0.2,  mcapHint: 24   },
];

const SP500_HOLDINGS: Holding[] = [
  { ticker: 'MSFT',  yahooTicker: 'MSFT',  name: 'Microsoft',              sector: 'Information Technology', weight: 6.2,  mcapHint: 3100 },
  { ticker: 'AAPL',  yahooTicker: 'AAPL',  name: 'Apple',                  sector: 'Information Technology', weight: 6.5,  mcapHint: 3300 },
  { ticker: 'NVDA',  yahooTicker: 'NVDA',  name: 'NVIDIA',                 sector: 'Information Technology', weight: 5.8,  mcapHint: 2600 },
  { ticker: 'AVGO',  yahooTicker: 'AVGO',  name: 'Broadcom',               sector: 'Information Technology', weight: 1.7,  mcapHint: 940  },
  { ticker: 'AMD',   yahooTicker: 'AMD',   name: 'Advanced Micro Devices', sector: 'Information Technology', weight: 0.5,  mcapHint: 230  },
  { ticker: 'QCOM',  yahooTicker: 'QCOM',  name: 'Qualcomm',               sector: 'Information Technology', weight: 0.45, mcapHint: 180  },
  { ticker: 'INTU',  yahooTicker: 'INTU',  name: 'Intuit',                 sector: 'Information Technology', weight: 0.45, mcapHint: 180  },
  { ticker: 'AMAT',  yahooTicker: 'AMAT',  name: 'Applied Materials',      sector: 'Information Technology', weight: 0.4,  mcapHint: 155  },
  { ticker: 'TXN',   yahooTicker: 'TXN',   name: 'Texas Instruments',      sector: 'Information Technology', weight: 0.4,  mcapHint: 165  },
  { ticker: 'ADI',   yahooTicker: 'ADI',   name: 'Analog Devices',         sector: 'Information Technology', weight: 0.28, mcapHint: 110  },
  { ticker: 'CSCO',  yahooTicker: 'CSCO',  name: 'Cisco Systems',          sector: 'Information Technology', weight: 0.45, mcapHint: 220  },
  { ticker: 'LRCX',  yahooTicker: 'LRCX',  name: 'Lam Research',           sector: 'Information Technology', weight: 0.25, mcapHint: 95   },
  { ticker: 'KLAC',  yahooTicker: 'KLAC',  name: 'KLA Corp',               sector: 'Information Technology', weight: 0.22, mcapHint: 85   },
  { ticker: 'CDNS',  yahooTicker: 'CDNS',  name: 'Cadence Design Systems', sector: 'Information Technology', weight: 0.2,  mcapHint: 80   },
  { ticker: 'SNPS',  yahooTicker: 'SNPS',  name: 'Synopsys',               sector: 'Information Technology', weight: 0.2,  mcapHint: 78   },
  { ticker: 'NOW',   yahooTicker: 'NOW',   name: 'ServiceNow',             sector: 'Information Technology', weight: 0.55, mcapHint: 200  },
  { ticker: 'CRM',   yahooTicker: 'CRM',   name: 'Salesforce',             sector: 'Information Technology', weight: 0.5,  mcapHint: 310  },
  { ticker: 'ORCL',  yahooTicker: 'ORCL',  name: 'Oracle',                 sector: 'Information Technology', weight: 0.6,  mcapHint: 430  },
  { ticker: 'IBM',   yahooTicker: 'IBM',   name: 'IBM',                    sector: 'Information Technology', weight: 0.3,  mcapHint: 200  },
  { ticker: 'ACN',   yahooTicker: 'ACN',   name: 'Accenture',              sector: 'Information Technology', weight: 0.4,  mcapHint: 215  },
  { ticker: 'PANW',  yahooTicker: 'PANW',  name: 'Palo Alto Networks',     sector: 'Information Technology', weight: 0.28, mcapHint: 110  },
  { ticker: 'ADSK',  yahooTicker: 'ADSK',  name: 'Autodesk',               sector: 'Information Technology', weight: 0.18, mcapHint: 56   },
  { ticker: 'CRWD',  yahooTicker: 'CRWD',  name: 'CrowdStrike',            sector: 'Information Technology', weight: 0.22, mcapHint: 90   },
  { ticker: 'ADP',   yahooTicker: 'ADP',   name: 'Automatic Data Processing', sector: 'Information Technology', weight: 0.3, mcapHint: 120 },
  { ticker: 'PAYX',  yahooTicker: 'PAYX',  name: 'Paychex',                sector: 'Information Technology', weight: 0.18, mcapHint: 55   },
  { ticker: 'INTC',  yahooTicker: 'INTC',  name: 'Intel',                  sector: 'Information Technology', weight: 0.22, mcapHint: 78   },
  { ticker: 'MU',    yahooTicker: 'MU',    name: 'Micron Technology',      sector: 'Information Technology', weight: 0.25, mcapHint: 95   },
  { ticker: 'FTNT',  yahooTicker: 'FTNT',  name: 'Fortinet',               sector: 'Information Technology', weight: 0.2,  mcapHint: 72   },
  { ticker: 'ARM',   yahooTicker: 'ARM',   name: 'Arm Holdings',           sector: 'Information Technology', weight: 0.3,  mcapHint: 130  },
  { ticker: 'FISERV',yahooTicker: 'FI',    name: 'Fiserv',                 sector: 'Information Technology', weight: 0.35, mcapHint: 100  },
  { ticker: 'BRK-B', yahooTicker: 'BRK-B', name: 'Berkshire Hathaway',     sector: 'Financials',             weight: 1.8,  mcapHint: 1050 },
  { ticker: 'JPM',   yahooTicker: 'JPM',   name: 'JPMorgan Chase',         sector: 'Financials',             weight: 1.5,  mcapHint: 720  },
  { ticker: 'V',     yahooTicker: 'V',     name: 'Visa',                   sector: 'Financials',             weight: 1.2,  mcapHint: 580  },
  { ticker: 'MA',    yahooTicker: 'MA',    name: 'Mastercard',             sector: 'Financials',             weight: 0.9,  mcapHint: 470  },
  { ticker: 'BAC',   yahooTicker: 'BAC',   name: 'Bank of America',        sector: 'Financials',             weight: 0.75, mcapHint: 310  },
  { ticker: 'GS',    yahooTicker: 'GS',    name: 'Goldman Sachs',          sector: 'Financials',             weight: 0.55, mcapHint: 200  },
  { ticker: 'MS',    yahooTicker: 'MS',    name: 'Morgan Stanley',         sector: 'Financials',             weight: 0.45, mcapHint: 155  },
  { ticker: 'WFC',   yahooTicker: 'WFC',   name: 'Wells Fargo',            sector: 'Financials',             weight: 0.45, mcapHint: 230  },
  { ticker: 'SPGI',  yahooTicker: 'SPGI',  name: 'S&P Global',             sector: 'Financials',             weight: 0.4,  mcapHint: 155  },
  { ticker: 'BLK',   yahooTicker: 'BLK',   name: 'BlackRock',              sector: 'Financials',             weight: 0.35, mcapHint: 145  },
  { ticker: 'C',     yahooTicker: 'C',     name: 'Citigroup',              sector: 'Financials',             weight: 0.35, mcapHint: 140  },
  { ticker: 'AXP',   yahooTicker: 'AXP',   name: 'American Express',       sector: 'Financials',             weight: 0.4,  mcapHint: 210  },
  { ticker: 'CB',    yahooTicker: 'CB',    name: 'Chubb',                  sector: 'Financials',             weight: 0.3,  mcapHint: 120  },
  { ticker: 'MCO',   yahooTicker: 'MCO',   name: "Moody's",                sector: 'Financials',             weight: 0.3,  mcapHint: 88   },
  { ticker: 'MMC',   yahooTicker: 'MMC',   name: 'Marsh & McLennan',       sector: 'Financials',             weight: 0.3,  mcapHint: 105  },
  { ticker: 'PGR',   yahooTicker: 'PGR',   name: 'Progressive',            sector: 'Financials',             weight: 0.4,  mcapHint: 145  },
  { ticker: 'ICE',   yahooTicker: 'ICE',   name: 'Intercontinental Exchange', sector: 'Financials',          weight: 0.3,  mcapHint: 80   },
  { ticker: 'CME',   yahooTicker: 'CME',   name: 'CME Group',              sector: 'Financials',             weight: 0.28, mcapHint: 82   },
  { ticker: 'AON',   yahooTicker: 'AON',   name: 'Aon',                    sector: 'Financials',             weight: 0.25, mcapHint: 77   },
  { ticker: 'USB',   yahooTicker: 'USB',   name: 'U.S. Bancorp',           sector: 'Financials',             weight: 0.2,  mcapHint: 62   },
  { ticker: 'PNC',   yahooTicker: 'PNC',   name: 'PNC Financial Services', sector: 'Financials',             weight: 0.22, mcapHint: 70   },
  { ticker: 'META',  yahooTicker: 'META',  name: 'Meta Platforms',         sector: 'Communication Services', weight: 2.7,  mcapHint: 1550 },
  { ticker: 'GOOGL', yahooTicker: 'GOOGL', name: 'Alphabet Class A',       sector: 'Communication Services', weight: 2.0,  mcapHint: 880  },
  { ticker: 'GOOG',  yahooTicker: 'GOOG',  name: 'Alphabet Class C',       sector: 'Communication Services', weight: 1.8,  mcapHint: 820  },
  { ticker: 'NFLX',  yahooTicker: 'NFLX',  name: 'Netflix',                sector: 'Communication Services', weight: 0.75, mcapHint: 380  },
  { ticker: 'TMUS',  yahooTicker: 'TMUS',  name: 'T-Mobile US',            sector: 'Communication Services', weight: 0.45, mcapHint: 270  },
  { ticker: 'T',     yahooTicker: 'T',     name: 'AT&T',                   sector: 'Communication Services', weight: 0.35, mcapHint: 175  },
  { ticker: 'VZ',    yahooTicker: 'VZ',    name: 'Verizon',                sector: 'Communication Services', weight: 0.3,  mcapHint: 165  },
  { ticker: 'CMCSA', yahooTicker: 'CMCSA', name: 'Comcast',                sector: 'Communication Services', weight: 0.3,  mcapHint: 135  },
  { ticker: 'DIS',   yahooTicker: 'DIS',   name: 'Walt Disney',            sector: 'Communication Services', weight: 0.35, mcapHint: 175  },
  { ticker: 'EA',    yahooTicker: 'EA',    name: 'Electronic Arts',        sector: 'Communication Services', weight: 0.12, mcapHint: 35   },
  { ticker: 'AMZN',  yahooTicker: 'AMZN',  name: 'Amazon',                 sector: 'Consumer Discretionary', weight: 3.8,  mcapHint: 2200 },
  { ticker: 'TSLA',  yahooTicker: 'TSLA',  name: 'Tesla',                  sector: 'Consumer Discretionary', weight: 2.2,  mcapHint: 1100 },
  { ticker: 'HD',    yahooTicker: 'HD',    name: 'Home Depot',             sector: 'Consumer Discretionary', weight: 0.65, mcapHint: 380  },
  { ticker: 'MCD',   yahooTicker: 'MCD',   name: "McDonald's",             sector: 'Consumer Discretionary', weight: 0.45, mcapHint: 220  },
  { ticker: 'BKNG',  yahooTicker: 'BKNG',  name: 'Booking Holdings',       sector: 'Consumer Discretionary', weight: 0.35, mcapHint: 170  },
  { ticker: 'NKE',   yahooTicker: 'NKE',   name: 'Nike',                   sector: 'Consumer Discretionary', weight: 0.3,  mcapHint: 120  },
  { ticker: 'TJX',   yahooTicker: 'TJX',   name: 'TJX Companies',          sector: 'Consumer Discretionary', weight: 0.4,  mcapHint: 145  },
  { ticker: 'LOW',   yahooTicker: 'LOW',   name: "Lowe's",                 sector: 'Consumer Discretionary', weight: 0.35, mcapHint: 150  },
  { ticker: 'SBUX',  yahooTicker: 'SBUX',  name: 'Starbucks',              sector: 'Consumer Discretionary', weight: 0.28, mcapHint: 95   },
  { ticker: 'ORLY',  yahooTicker: 'ORLY',  name: "O'Reilly Automotive",    sector: 'Consumer Discretionary', weight: 0.2,  mcapHint: 72   },
  { ticker: 'GM',    yahooTicker: 'GM',    name: 'General Motors',         sector: 'Consumer Discretionary', weight: 0.22, mcapHint: 52   },
  { ticker: 'F',     yahooTicker: 'F',     name: 'Ford Motor',             sector: 'Consumer Discretionary', weight: 0.15, mcapHint: 42   },
  { ticker: 'MAR',   yahooTicker: 'MAR',   name: 'Marriott International', sector: 'Consumer Discretionary', weight: 0.22, mcapHint: 75   },
  { ticker: 'ROST',  yahooTicker: 'ROST',  name: 'Ross Stores',            sector: 'Consumer Discretionary', weight: 0.2,  mcapHint: 47   },
  { ticker: 'ABNB',  yahooTicker: 'ABNB',  name: 'Airbnb',                 sector: 'Consumer Discretionary', weight: 0.2,  mcapHint: 82   },
  { ticker: 'WMT',   yahooTicker: 'WMT',   name: 'Walmart',                sector: 'Consumer Staples',       weight: 1.1,  mcapHint: 780  },
  { ticker: 'KO',    yahooTicker: 'KO',    name: 'Coca-Cola',              sector: 'Consumer Staples',       weight: 0.7,  mcapHint: 295  },
  { ticker: 'PEP',   yahooTicker: 'PEP',   name: 'PepsiCo',                sector: 'Consumer Staples',       weight: 0.55, mcapHint: 195  },
  { ticker: 'COST',  yahooTicker: 'COST',  name: 'Costco',                 sector: 'Consumer Staples',       weight: 0.85, mcapHint: 430  },
  { ticker: 'PM',    yahooTicker: 'PM',    name: 'Philip Morris',          sector: 'Consumer Staples',       weight: 0.45, mcapHint: 240  },
  { ticker: 'MO',    yahooTicker: 'MO',    name: 'Altria Group',           sector: 'Consumer Staples',       weight: 0.2,  mcapHint: 88   },
  { ticker: 'MDLZ',  yahooTicker: 'MDLZ',  name: 'Mondelez International', sector: 'Consumer Staples',       weight: 0.22, mcapHint: 87   },
  { ticker: 'CL',    yahooTicker: 'CL',    name: 'Colgate-Palmolive',      sector: 'Consumer Staples',       weight: 0.2,  mcapHint: 64   },
  { ticker: 'PG',    yahooTicker: 'PG',    name: 'Procter & Gamble',       sector: 'Consumer Staples',       weight: 0.6,  mcapHint: 380  },
  { ticker: 'KR',    yahooTicker: 'KR',    name: 'Kroger',                 sector: 'Consumer Staples',       weight: 0.12, mcapHint: 40   },
  { ticker: 'UNH',   yahooTicker: 'UNH',   name: 'UnitedHealth Group',     sector: 'Health Care',            weight: 1.3,  mcapHint: 500  },
  { ticker: 'LLY',   yahooTicker: 'LLY',   name: 'Eli Lilly',              sector: 'Health Care',            weight: 1.5,  mcapHint: 740  },
  { ticker: 'JNJ',   yahooTicker: 'JNJ',   name: 'Johnson & Johnson',      sector: 'Health Care',            weight: 0.65, mcapHint: 375  },
  { ticker: 'ABBV',  yahooTicker: 'ABBV',  name: 'AbbVie',                 sector: 'Health Care',            weight: 0.7,  mcapHint: 325  },
  { ticker: 'MRK',   yahooTicker: 'MRK',   name: 'Merck',                  sector: 'Health Care',            weight: 0.5,  mcapHint: 245  },
  { ticker: 'TMO',   yahooTicker: 'TMO',   name: 'Thermo Fisher Scientific', sector: 'Health Care',          weight: 0.5,  mcapHint: 205  },
  { ticker: 'ABT',   yahooTicker: 'ABT',   name: 'Abbott Laboratories',    sector: 'Health Care',            weight: 0.45, mcapHint: 190  },
  { ticker: 'ISRG',  yahooTicker: 'ISRG',  name: 'Intuitive Surgical',     sector: 'Health Care',            weight: 0.45, mcapHint: 195  },
  { ticker: 'AMGN',  yahooTicker: 'AMGN',  name: 'Amgen',                  sector: 'Health Care',            weight: 0.4,  mcapHint: 155  },
  { ticker: 'BSX',   yahooTicker: 'BSX',   name: 'Boston Scientific',      sector: 'Health Care',            weight: 0.35, mcapHint: 130  },
  { ticker: 'SYK',   yahooTicker: 'SYK',   name: 'Stryker',                sector: 'Health Care',            weight: 0.35, mcapHint: 130  },
  { ticker: 'GILD',  yahooTicker: 'GILD',  name: 'Gilead Sciences',        sector: 'Health Care',            weight: 0.28, mcapHint: 115  },
  { ticker: 'REGN',  yahooTicker: 'REGN',  name: 'Regeneron',              sector: 'Health Care',            weight: 0.28, mcapHint: 115  },
  { ticker: 'VRTX',  yahooTicker: 'VRTX',  name: 'Vertex Pharmaceuticals', sector: 'Health Care',            weight: 0.35, mcapHint: 120  },
  { ticker: 'CI',    yahooTicker: 'CI',    name: 'Cigna',                  sector: 'Health Care',            weight: 0.3,  mcapHint: 90   },
  { ticker: 'HCA',   yahooTicker: 'HCA',   name: 'HCA Healthcare',         sector: 'Health Care',            weight: 0.28, mcapHint: 90   },
  { ticker: 'ZTS',   yahooTicker: 'ZTS',   name: 'Zoetis',                 sector: 'Health Care',            weight: 0.22, mcapHint: 80   },
  { ticker: 'MDT',   yahooTicker: 'MDT',   name: 'Medtronic',              sector: 'Health Care',            weight: 0.2,  mcapHint: 90   },
  { ticker: 'EW',    yahooTicker: 'EW',    name: 'Edwards Lifesciences',   sector: 'Health Care',            weight: 0.18, mcapHint: 45   },
  { ticker: 'GE',    yahooTicker: 'GE',    name: 'GE Aerospace',           sector: 'Industrials',            weight: 0.65, mcapHint: 220  },
  { ticker: 'RTX',   yahooTicker: 'RTX',   name: 'RTX Corp',               sector: 'Industrials',            weight: 0.5,  mcapHint: 170  },
  { ticker: 'CAT',   yahooTicker: 'CAT',   name: 'Caterpillar',            sector: 'Industrials',            weight: 0.55, mcapHint: 175  },
  { ticker: 'HON',   yahooTicker: 'HON',   name: 'Honeywell',              sector: 'Industrials',            weight: 0.5,  mcapHint: 130  },
  { ticker: 'UNP',   yahooTicker: 'UNP',   name: 'Union Pacific',          sector: 'Industrials',            weight: 0.45, mcapHint: 155  },
  { ticker: 'DE',    yahooTicker: 'DE',    name: 'Deere & Company',        sector: 'Industrials',            weight: 0.4,  mcapHint: 125  },
  { ticker: 'LMT',   yahooTicker: 'LMT',   name: 'Lockheed Martin',        sector: 'Industrials',            weight: 0.35, mcapHint: 115  },
  { ticker: 'ETN',   yahooTicker: 'ETN',   name: 'Eaton',                  sector: 'Industrials',            weight: 0.4,  mcapHint: 140  },
  { ticker: 'EMR',   yahooTicker: 'EMR',   name: 'Emerson Electric',       sector: 'Industrials',            weight: 0.25, mcapHint: 68   },
  { ticker: 'ITW',   yahooTicker: 'ITW',   name: 'Illinois Tool Works',    sector: 'Industrials',            weight: 0.3,  mcapHint: 80   },
  { ticker: 'CTAS',  yahooTicker: 'CTAS',  name: 'Cintas',                 sector: 'Industrials',            weight: 0.28, mcapHint: 82   },
  { ticker: 'WM',    yahooTicker: 'WM',    name: 'Waste Management',       sector: 'Industrials',            weight: 0.28, mcapHint: 92   },
  { ticker: 'NSC',   yahooTicker: 'NSC',   name: 'Norfolk Southern',       sector: 'Industrials',            weight: 0.2,  mcapHint: 60   },
  { ticker: 'GWW',   yahooTicker: 'GWW',   name: 'W.W. Grainger',          sector: 'Industrials',            weight: 0.22, mcapHint: 55   },
  { ticker: 'CARR',  yahooTicker: 'CARR',  name: 'Carrier Global',         sector: 'Industrials',            weight: 0.2,  mcapHint: 68   },
  { ticker: 'TDG',   yahooTicker: 'TDG',   name: 'TransDigm',              sector: 'Industrials',            weight: 0.25, mcapHint: 72   },
  { ticker: 'CSX',   yahooTicker: 'CSX',   name: 'CSX Corp',               sector: 'Industrials',            weight: 0.2,  mcapHint: 50   },
  { ticker: 'PCAR',  yahooTicker: 'PCAR',  name: 'PACCAR',                 sector: 'Industrials',            weight: 0.15, mcapHint: 58   },
  { ticker: 'ODFL',  yahooTicker: 'ODFL',  name: 'Old Dominion Freight',   sector: 'Industrials',            weight: 0.15, mcapHint: 42   },
  { ticker: 'PWR',   yahooTicker: 'PWR',   name: 'Quanta Services',        sector: 'Industrials',            weight: 0.2,  mcapHint: 55   },
  { ticker: 'XOM',   yahooTicker: 'XOM',   name: 'ExxonMobil',             sector: 'Energy',                 weight: 1.3,  mcapHint: 490  },
  { ticker: 'CVX',   yahooTicker: 'CVX',   name: 'Chevron',                sector: 'Energy',                 weight: 0.8,  mcapHint: 275  },
  { ticker: 'COP',   yahooTicker: 'COP',   name: 'ConocoPhillips',         sector: 'Energy',                 weight: 0.35, mcapHint: 115  },
  { ticker: 'EOG',   yahooTicker: 'EOG',   name: 'EOG Resources',          sector: 'Energy',                 weight: 0.22, mcapHint: 68   },
  { ticker: 'PSX',   yahooTicker: 'PSX',   name: 'Phillips 66',            sector: 'Energy',                 weight: 0.2,  mcapHint: 58   },
  { ticker: 'VLO',   yahooTicker: 'VLO',   name: 'Valero Energy',          sector: 'Energy',                 weight: 0.18, mcapHint: 48   },
  { ticker: 'MPC',   yahooTicker: 'MPC',   name: 'Marathon Petroleum',     sector: 'Energy',                 weight: 0.2,  mcapHint: 62   },
  { ticker: 'SLB',   yahooTicker: 'SLB',   name: 'SLB',                    sector: 'Energy',                 weight: 0.18, mcapHint: 52   },
  { ticker: 'OKE',   yahooTicker: 'OKE',   name: 'ONEOK',                  sector: 'Energy',                 weight: 0.15, mcapHint: 50   },
  { ticker: 'WMB',   yahooTicker: 'WMB',   name: 'Williams Companies',     sector: 'Energy',                 weight: 0.15, mcapHint: 62   },
  { ticker: 'FANG',  yahooTicker: 'FANG',  name: 'Diamondback Energy',     sector: 'Energy',                 weight: 0.15, mcapHint: 24   },
  { ticker: 'LIN',   yahooTicker: 'LIN',   name: 'Linde',                  sector: 'Materials',              weight: 0.45, mcapHint: 210  },
  { ticker: 'APD',   yahooTicker: 'APD',   name: 'Air Products',           sector: 'Materials',              weight: 0.18, mcapHint: 55   },
  { ticker: 'FCX',   yahooTicker: 'FCX',   name: 'Freeport-McMoRan',       sector: 'Materials',              weight: 0.18, mcapHint: 52   },
  { ticker: 'NEM',   yahooTicker: 'NEM',   name: 'Newmont',                sector: 'Materials',              weight: 0.15, mcapHint: 40   },
  { ticker: 'ECL',   yahooTicker: 'ECL',   name: 'Ecolab',                 sector: 'Materials',              weight: 0.15, mcapHint: 68   },
  { ticker: 'SHW',   yahooTicker: 'SHW',   name: 'Sherwin-Williams',       sector: 'Materials',              weight: 0.22, mcapHint: 88   },
  { ticker: 'ALB',   yahooTicker: 'ALB',   name: 'Albemarle',              sector: 'Materials',              weight: 0.08, mcapHint: 10   },
  { ticker: 'PLD',   yahooTicker: 'PLD',   name: 'Prologis',               sector: 'Real Estate',            weight: 0.3,  mcapHint: 105  },
  { ticker: 'AMT',   yahooTicker: 'AMT',   name: 'American Tower',         sector: 'Real Estate',            weight: 0.25, mcapHint: 82   },
  { ticker: 'EQIX',  yahooTicker: 'EQIX',  name: 'Equinix',                sector: 'Real Estate',            weight: 0.22, mcapHint: 80   },
  { ticker: 'WELL',  yahooTicker: 'WELL',  name: 'Welltower',              sector: 'Real Estate',            weight: 0.18, mcapHint: 82   },
  { ticker: 'PSA',   yahooTicker: 'PSA',   name: 'Public Storage',         sector: 'Real Estate',            weight: 0.15, mcapHint: 52   },
  { ticker: 'SPG',   yahooTicker: 'SPG',   name: 'Simon Property Group',   sector: 'Real Estate',            weight: 0.18, mcapHint: 60   },
  { ticker: 'O',     yahooTicker: 'O',     name: 'Realty Income',          sector: 'Real Estate',            weight: 0.12, mcapHint: 48   },
  { ticker: 'DLR',   yahooTicker: 'DLR',   name: 'Digital Realty',         sector: 'Real Estate',            weight: 0.12, mcapHint: 48   },
  { ticker: 'NEE',   yahooTicker: 'NEE',   name: 'NextEra Energy',         sector: 'Utilities',              weight: 0.5,  mcapHint: 145  },
  { ticker: 'DUK',   yahooTicker: 'DUK',   name: 'Duke Energy',            sector: 'Utilities',              weight: 0.25, mcapHint: 82   },
  { ticker: 'SO',    yahooTicker: 'SO',    name: 'Southern Company',       sector: 'Utilities',              weight: 0.25, mcapHint: 80   },
  { ticker: 'D',     yahooTicker: 'D',     name: 'Dominion Energy',        sector: 'Utilities',              weight: 0.18, mcapHint: 42   },
  { ticker: 'AEP',   yahooTicker: 'AEP',   name: 'American Electric Power',sector: 'Utilities',              weight: 0.18, mcapHint: 44   },
  { ticker: 'EXC',   yahooTicker: 'EXC',   name: 'Exelon',                 sector: 'Utilities',              weight: 0.15, mcapHint: 32   },
  { ticker: 'XEL',   yahooTicker: 'XEL',   name: 'Xcel Energy',            sector: 'Utilities',              weight: 0.12, mcapHint: 28   },
  { ticker: 'CEG',   yahooTicker: 'CEG',   name: 'Constellation Energy',   sector: 'Utilities',              weight: 0.3,  mcapHint: 72   },
  { ticker: 'SRE',   yahooTicker: 'SRE',   name: 'Sempra',                 sector: 'Utilities',              weight: 0.15, mcapHint: 42   },
  { ticker: 'PCG',   yahooTicker: 'PCG',   name: 'PG&E',                   sector: 'Utilities',              weight: 0.12, mcapHint: 35   },
  { ticker: 'WEC',   yahooTicker: 'WEC',   name: 'WEC Energy Group',       sector: 'Utilities',              weight: 0.1,  mcapHint: 28   },
  { ticker: 'ED',    yahooTicker: 'ED',    name: 'Consolidated Edison',    sector: 'Utilities',              weight: 0.1,  mcapHint: 30   },
];

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

  // Collect all unique tickers across all three indices
  const tsxHoldings = await loadTSXHoldings();
  console.log(`TSX: ${tsxHoldings.length} holdings`);

  const allHoldings = [...tsxHoldings, ...NASDAQ100_HOLDINGS, ...SP500_HOLDINGS];
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
  const tsx = await buildIndex('TSX', tsxHoldings, resultMap, 'America/Toronto', CA_HOLIDAYS);
  const sp500 = await buildIndex('S&P 500', SP500_HOLDINGS, resultMap, 'America/New_York', US_HOLIDAYS);
  const nasdaq = await buildIndex('NASDAQ-100', NASDAQ100_HOLDINGS, resultMap, 'America/New_York', US_HOLIDAYS);

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
