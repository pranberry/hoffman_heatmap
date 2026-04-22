import { useState, useEffect } from 'react';
import type { HeatmapData } from '../types';
import { HeatmapView } from './HeatmapView';
import { HEATMAP_INDEX_LABELS } from '../config/tabs';

const REFRESH_INTERVAL = 15 * 60 * 1000;
const IDX = HEATMAP_INDEX_LABELS.tsx;

export function TSXHeatmap() {
  const [data,    setData]    = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function fetchData() {
      try {
        const res = await fetch('/data/tsx.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: HeatmapData = await res.json();
        if (mounted) { setData(json); setLoading(false); }
      } catch (e) {
        console.error('Failed to fetch TSX data:', e);
        if (mounted) setLoading(false);
      }
    }
    fetchData();
    const id = setInterval(fetchData, REFRESH_INTERVAL);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  return (
    <HeatmapView
      data={data}
      loading={loading}
      indexLabel={IDX.full}
      topN={IDX.topN}
      topNLabel={IDX.topNLabel}
      loadingText="Loading TSX data..."
    />
  );
}
