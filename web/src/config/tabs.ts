export const TAB_LABELS = {
  canHeatmap: 'CAN Heatmap',
  usHeatmap:  'US Heatmap',
} as const;

export type TabId = keyof typeof TAB_LABELS;

export const HEATMAP_INDEX_LABELS = {
  tsx:    { full: 'S&P/TSX Composite',  short: 'TSX',     topN: 60,  topNLabel: 'Top 60'  },
  sp500:  { full: 'S&P 500',            short: 'S&P 500', topN: 100, topNLabel: 'Top 100' },
  nasdaq: { full: 'NASDAQ-100',         short: 'NASDAQ',  topN: 50,  topNLabel: 'Top 50'  },
} as const;
