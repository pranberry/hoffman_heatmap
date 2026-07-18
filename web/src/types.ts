export interface HeatmapStockData {
  ticker: string;
  name: string;
  price: number;
  mcap: number;
  weight: number;
  changeDay: number;
  changeMonth: number;
  // Optional: only present in data fetched after these periods were added
  change3Month?: number;
  change6Month?: number;
  changeYTD?: number;
  changeYear: number;
}

export interface HeatmapSectorData {
  name: string;
  stocks: HeatmapStockData[];
}

export interface HeatmapIndexChanges {
  changeDay: number;
  changeMonth: number;
  change3Month?: number;
  change6Month?: number;
  changeYTD?: number;
  changeYear: number;
}

export interface HeatmapData {
  lastUpdated: string;
  tickerCount: number;
  sectors: HeatmapSectorData[];
  isMarketOpen?: boolean;
  // True benchmark index returns for the headline number; older data
  // files don't have this and fall back to a weighted average
  indexChanges?: HeatmapIndexChanges;
}
