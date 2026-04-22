import { useState, useEffect, useMemo } from 'react';
import type { HeatmapData } from '../types';
import { HeatmapView } from './HeatmapView';
import { HEATMAP_INDEX_LABELS } from '../config/tabs';
import { useDarkMode } from '../hooks/useDarkMode';

const REFRESH_INTERVAL = 15 * 60 * 1000;

type UsIndex = 'sp500' | 'nasdaq';

export function USHeatmap() {
  const isDark = useDarkMode();
  const [sp500Data,   setSp500Data]   = useState<HeatmapData | null>(null);
  const [nasdaqData,  setNasdaqData]  = useState<HeatmapData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [activeIdx,   setActiveIdx]   = useState<UsIndex>('sp500');

  useEffect(() => {
    let mounted = true;
    async function fetchData() {
      try {
        const [sp500Res, nasdaqRes] = await Promise.all([
          fetch('/data/sp500.json'),
          fetch('/data/nasdaq.json'),
        ]);
        if (mounted) {
          if (sp500Res.ok)  setSp500Data(await sp500Res.json());
          if (nasdaqRes.ok) setNasdaqData(await nasdaqRes.json());
          setLoading(false);
        }
      } catch (e) {
        console.error('Failed to fetch US data:', e);
        if (mounted) setLoading(false);
      }
    }
    fetchData();
    const id = setInterval(fetchData, REFRESH_INTERVAL);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const activeData = useMemo(
    () => activeIdx === 'sp500' ? sp500Data : nasdaqData,
    [activeIdx, sp500Data, nasdaqData]
  );

  const idx = activeIdx === 'sp500' ? HEATMAP_INDEX_LABELS.sp500 : HEATMAP_INDEX_LABELS.nasdaq;

  const buttonBg         = isDark ? '#1a1a2e' : '#f3f4f6';
  const buttonBorder     = isDark ? '#2a2a3e' : '#d1d5db';
  const buttonBgSelected = isDark ? '#2a2a4e' : '#e5e7eb';
  const text             = isDark ? '#ffffff' : '#111827';
  const subText          = isDark ? '#666666' : '#6b7280';

  const indexToggle = (
    <div
      className="flex"
      style={{ background: buttonBg, padding: 2, borderRadius: 4, border: `1px solid ${buttonBorder}` }}
    >
      {(['sp500', 'nasdaq'] as UsIndex[]).map(id => {
        const label = id === 'sp500' ? HEATMAP_INDEX_LABELS.sp500.short : HEATMAP_INDEX_LABELS.nasdaq.short;
        const active = id === activeIdx;
        return (
          <button
            key={id}
            onClick={() => setActiveIdx(id)}
            className="px-3 py-0.5 rounded text-[10px] font-bold uppercase cursor-pointer transition-all"
            style={{
              background: active ? buttonBgSelected : 'transparent',
              color:      active ? text             : subText,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  return (
    <HeatmapView
      data={activeData}
      loading={loading}
      indexLabel={idx.full}
      topN={idx.topN}
      topNLabel={idx.topNLabel}
      loadingText="Loading US market data..."
      leftControls={indexToggle}
    />
  );
}
