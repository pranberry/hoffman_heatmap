export interface HeatmapStockData {
  ticker: string;
  name: string;
  price: number;
  mcap: number;
  weight: number;
  changeDay: number;
  changeMonth: number;
  changeYear: number;
}

export interface HeatmapSectorData {
  name: string;
  stocks: HeatmapStockData[];
}

export interface HeatmapData {
  lastUpdated: string;
  tickerCount: number;
  sectors: HeatmapSectorData[];
  isMarketOpen?: boolean;
}
