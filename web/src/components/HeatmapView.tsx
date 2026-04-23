import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import type { HeatmapData, HeatmapStockData } from '../types';
import { useDarkMode } from '../hooks/useDarkMode';

// ── Color helpers ──────────────────────────────────────────────────────────────

const COLOR_CAPS: Record<string, number> = { '1D': 4, '1M': 15, '1Y': 30 };

function getColor(change: number, period: string, isDark: boolean): string {
  const cap     = COLOR_CAPS[period];
  const clamped = Math.max(-cap, Math.min(cap, change));
  const t       = clamped / cap;

  if (Math.abs(t) < 0.01) return isDark ? '#2a2a35' : '#f3f4f6';

  if (t > 0) {
    const start = isDark ? [20, 30, 25]    : [243, 244, 246];
    const end   = isDark ? [0, 160, 50]    : [22, 163, 74];
    return `rgb(${lerp(start[0], end[0], t)},${lerp(start[1], end[1], t)},${lerp(start[2], end[2], t)})`;
  } else {
    const absT  = -t;
    const start = isDark ? [30, 20, 25]    : [243, 244, 246];
    const end   = isDark ? [200, 20, 30]   : [220, 38, 38];
    return `rgb(${lerp(start[0], end[0], absT)},${lerp(start[1], end[1], absT)},${lerp(start[2], end[2], absT)})`;
  }
}

function lerp(a: number, b: number, t: number) { return Math.round(a + (b - a) * t); }

function getTextColor(change: number, period: string, isDark: boolean): string {
  const t = Math.abs(change) / COLOR_CAPS[period];
  return isDark ? (t > 0.15 ? '#ffffff' : '#bbbbbb') : (t > 0.4 ? '#ffffff' : '#111827');
}

// ── Types ──────────────────────────────────────────────────────────────────────

type Period    = '1D' | '1M' | '1Y';
type ChangeKey = 'changeDay' | 'changeMonth' | 'changeYear';

export interface HeatmapViewProps {
  data:           HeatmapData | null;
  loading:        boolean;
  indexLabel:     string;
  topN:           number;
  topNLabel:      string;
  loadingText?:   string;
  leftControls?:  React.ReactNode;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function HeatmapView({
  data,
  loading,
  indexLabel,
  topN,
  topNLabel,
  loadingText   = 'Loading data...',
  leftControls,
}: HeatmapViewProps) {
  const isDark = useDarkMode();

  const [period,         setPeriod]         = useState<Period>('1D');
  const [showAll,        setShowAll]         = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 768
  );
  const [showPrice,      setShowPrice]       = useState(false);
  const [selectedSector, setSelectedSector]  = useState<string | null>(null);
  const [hoveredStock,   setHoveredStock]    = useState<HeatmapStockData | null>(null);
  const [mousePos,       setMousePos]        = useState({ x: 0, y: 0 });
  const [dimensions,     setDimensions]      = useState({ width: 0, height: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef   = useRef<HTMLDivElement>(null);

  useEffect(() => { setSelectedSector(null); }, [indexLabel]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading]);

  const theme = useMemo(() => ({
    bg:                   isDark ? '#0a0a0f'                  : '#ffffff',
    headerBorder:         isDark ? '#1a1a2e'                  : '#e5e7eb',
    text:                 isDark ? '#ffffff'                  : '#111827',
    indexText:            isDark ? '#e0e0e0'                  : '#1f2937',
    subText:              isDark ? '#666666'                  : '#6b7280',
    mutedText:            isDark ? '#888888'                  : '#9ca3af',
    buttonBg:             isDark ? '#1a1a2e'                  : '#f3f4f6',
    buttonBgSelected:     isDark ? '#2a2a4e'                  : '#e5e7eb',
    buttonBorder:         isDark ? '#2a2a3e'                  : '#d1d5db',
    buttonBorderSelected: isDark ? '#4a4a6e'                  : '#9ca3af',
    sectorStroke:         isDark ? '#1a1a2e'                  : '#e5e7eb',
    stockStroke:          isDark ? '#0a0a0f'                  : '#ffffff',
    tooltipBg:            isDark ? 'rgba(10,10,20,0.95)'      : 'rgba(255,255,255,0.98)',
    tooltipBorder:        isDark ? '#333333'                  : '#e5e7eb',
    tooltipShadow:        isDark ? '0 10px 15px -3px rgba(0,0,0,0.5)' : '0 10px 15px -3px rgba(0,0,0,0.1)',
  }), [isDark]);

  const changeKey: ChangeKey = period === '1D' ? 'changeDay' : period === '1M' ? 'changeMonth' : 'changeYear';

  const isLive = !!(data && data.isMarketOpen === true);

  const filteredData = useMemo(() => {
    if (!data) return null;
    let sectors = data.sectors;

    if (!showAll) {
      const allStocks = data.sectors.flatMap(s => s.stocks.map(st => ({ ...st, _sector: s.name })));
      const topStocks = allStocks.sort((a, b) => b.weight - a.weight).slice(0, topN);
      const map = new Map<string, HeatmapStockData[]>();
      topStocks.forEach(st => {
        const sec = (st as any)._sector as string;
        if (!map.has(sec)) map.set(sec, []);
        map.get(sec)!.push(st);
      });
      sectors = Array.from(map.entries())
        .map(([name, stocks]) => ({ name, stocks: stocks.sort((a, b) => b.mcap - a.mcap) }))
        .sort((a, b) =>
          b.stocks.reduce((s, st) => s + st.mcap, 0) - a.stocks.reduce((s, st) => s + st.mcap, 0)
        );
    }

    if (selectedSector) sectors = sectors.filter(s => s.name === selectedSector);
    return { ...data, sectors };
  }, [data, showAll, selectedSector, topN]);

  const displayCount = useMemo(
    () => filteredData?.sectors.reduce((n, s) => n + s.stocks.length, 0) ?? 0,
    [filteredData]
  );

  const treemapData = useMemo(() => {
    if (!filteredData || dimensions.width === 0) return null;
    const isSingle = filteredData.sectors.length === 1;
    // Flatten the size ratio between mega-caps and mid-caps on narrow screens
    // so a handful of giants don't consume the whole viewport.
    const sizeExp = dimensions.width < 768 ? 0.5 : 1;

    const root = d3
      .hierarchy({
        name: 'root',
        children: filteredData.sectors.map(sector => ({
          name: sector.name,
          children: sector.stocks.map(s => ({
            ...s,
            value: Math.pow(Math.max(s.mcap, 0.01), sizeExp),
          })),
        })),
      })
      .sum((d: any) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    d3.treemap<any>()
      .size([dimensions.width, dimensions.height])
      .padding(1)
      .paddingTop(isSingle ? 2 : 18)
      .paddingOuter(2)
      .tile(d3.treemapSquarify.ratio(1.2))(root);

    return root;
  }, [filteredData, dimensions]);

  const sectorSummaries = useMemo(() => {
    if (!data) return [];
    return data.sectors
      .map(sector => {
        const totalW = sector.stocks.reduce((s, st) => s + st.weight, 0);
        const change = totalW > 0
          ? sector.stocks.reduce((s, st) => s + st[changeKey] * st.weight, 0) / totalW
          : 0;
        return { name: sector.name, change: Math.round(change * 100) / 100 };
      })
      .sort((a, b) => b.change - a.change);
  }, [data, changeKey]);

  const indexChange = useMemo(() => {
    if (!data) return 0;
    let tw = 0, ws = 0;
    for (const sector of data.sectors)
      for (const stock of sector.stocks) { tw += stock.weight; ws += stock[changeKey] * stock.weight; }
    return tw > 0 ? Math.round((ws / tw) * 100) / 100 : 0;
  }, [data, changeKey]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  }, []);

  const tooltipPos = useMemo(() => {
    const tt  = tooltipRef.current;
    const gap = 15;
    let left  = mousePos.x + gap;
    let top   = mousePos.y - 10;
    if (tt) {
      if (left + tt.offsetWidth  > window.innerWidth  - 8) left = mousePos.x - tt.offsetWidth  - gap;
      if (top  + tt.offsetHeight > window.innerHeight - 8) top  = window.innerHeight - tt.offsetHeight - 8;
      if (top < 8) top = 8;
    }
    return { left, top };
  }, [mousePos]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: theme.bg }}>
        <div className="text-sm" style={{ color: theme.mutedText }}>{loadingText}</div>
      </div>
    );
  }

  const sectorNodes: any[] = treemapData ? treemapData.children || [] : [];

  function SegmentedControl({ options, value, onChange }: {
    options: { label: string; value: string }[];
    value: string;
    onChange: (v: string) => void;
  }) {
    return (
      <div
        className="flex"
        style={{ background: theme.buttonBg, padding: 2, borderRadius: 4, border: `1px solid ${theme.buttonBorder}` }}
      >
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="px-3 py-0.5 rounded text-[10px] font-bold uppercase cursor-pointer transition-all"
            style={{
              background: value === opt.value ? theme.buttonBgSelected : 'transparent',
              color:      value === opt.value ? theme.text             : theme.subText,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ background: theme.bg, color: theme.indexText, fontFamily: "'Inter', system-ui, sans-serif" }}
      onMouseMove={handleMouseMove}
    >
      {/* ── Header ── */}
      <div
        className="flex flex-wrap justify-between items-center gap-y-2 gap-x-3 px-4 py-2 flex-shrink-0"
        style={{ borderBottom: `1px solid ${theme.headerBorder}` }}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <span className="text-base font-semibold truncate" style={{ color: theme.text }}>{indexLabel}</span>
          <span className="text-sm font-bold font-mono flex-shrink-0" style={{ color: indexChange >= 0 ? '#22c55e' : '#ef4444' }}>
            {indexChange >= 0 ? '+' : ''}{indexChange.toFixed(2)}%
          </span>
          <span className="text-xs flex items-center gap-1 flex-shrink-0" style={{ color: theme.mutedText }}>
            <span style={{ color: isLive ? '#22c55e' : '#999', fontSize: 10 }}>●</span>
            {isLive ? 'LIVE' : 'MARKET CLOSED'}
          </span>
          <span className="text-xs flex-shrink-0" style={{ color: theme.subText }}>{displayCount} stocks</span>
          {data?.lastUpdated && (
            <span className="text-xs flex-shrink-0" style={{ color: theme.subText }}>
              Updated {data.lastUpdated} · data delayed by ~15 minutes
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {leftControls}

          <SegmentedControl
            options={[{ label: 'All', value: 'all' }, { label: topNLabel, value: 'topn' }]}
            value={showAll ? 'all' : 'topn'}
            onChange={v => setShowAll(v === 'all')}
          />

          <div className="flex gap-1">
            {(['1D', '1M', '1Y'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className="px-3 py-1 rounded text-xs font-semibold font-mono cursor-pointer transition-all"
                style={{
                  background: period === p ? theme.buttonBgSelected : theme.buttonBg,
                  border:     `1px solid ${period === p ? theme.buttonBorderSelected : theme.buttonBorder}`,
                  color:      period === p ? theme.text              : theme.mutedText,
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Sector bar ── */}
      <div
        className="flex gap-1.5 px-4 py-1.5 overflow-x-auto flex-shrink-0"
        style={{ borderBottom: `1px solid ${theme.headerBorder}` }}
      >
        <div
          onClick={() => setSelectedSector(null)}
          className="flex items-center px-2 py-0.5 rounded cursor-pointer flex-shrink-0"
          style={{
            backgroundColor: !selectedSector ? theme.buttonBgSelected : theme.buttonBg,
            border:           `1px solid ${!selectedSector ? theme.buttonBorderSelected : theme.buttonBorder}`,
          }}
        >
          <span className="text-xs font-semibold" style={{ color: !selectedSector ? theme.text : theme.mutedText }}>All</span>
        </div>
        {sectorSummaries.map(s => (
          <div
            key={s.name}
            onClick={() => setSelectedSector(selectedSector === s.name ? null : s.name)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer flex-shrink-0 whitespace-nowrap"
            style={{
              backgroundColor: getColor(s.change, period, isDark),
              outline:         selectedSector === s.name ? `2px solid ${theme.text}` : 'none',
              outlineOffset:   -1,
            }}
          >
            <span className="text-xs font-medium" style={{ color: getTextColor(s.change, period, isDark) }}>{s.name}</span>
            <span className="font-mono text-xs" style={{ color: s.change >= 0 ? (isDark ? '#4ade80' : '#166534') : (isDark ? '#f87171' : '#991b1b') }}>
              {s.change >= 0 ? '+' : ''}{s.change.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>

      {/* ── Treemap ── */}
      <div ref={containerRef} className="flex-1 overflow-hidden relative">
        {treemapData && dimensions.width > 0 && (
          <svg width={dimensions.width} height={dimensions.height} style={{ display: 'block' }}>
            {!selectedSector && sectorNodes.map((sector: any) => (
              <g key={sector.data.name}>
                <rect
                  x={sector.x0} y={sector.y0}
                  width={sector.x1 - sector.x0} height={sector.y1 - sector.y0}
                  fill="none" stroke={theme.sectorStroke} strokeWidth={2}
                />
                <text
                  x={sector.x0 + 4} y={sector.y0 + 13}
                  fill={theme.mutedText} fontSize={11} fontWeight={600}
                >
                  {sector.data.name}
                </text>
              </g>
            ))}

            {sectorNodes.flatMap((sector: any) =>
              (sector.children || []).map((leaf: any) => {
                const w = leaf.x1 - leaf.x0;
                const h = leaf.y1 - leaf.y0;
                const change     = leaf.data[changeKey] as number;
                const bg         = getColor(change, period, isDark);
                const fg         = getTextColor(change, period, isDark);
                const showTicker = w > 28 && h > 16;
                const showSub    = w > 36 && h > 28;

                return (
                  <g
                    key={leaf.data.ticker}
                    onMouseEnter={() => setHoveredStock(leaf.data)}
                    onMouseLeave={() => setHoveredStock(null)}
                    onClick={() => setShowPrice(p => !p)}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect
                      x={leaf.x0} y={leaf.y0} width={w} height={h}
                      fill={bg} stroke={theme.stockStroke} strokeWidth={0.5} rx={1}
                    />
                    {showTicker && (
                      <text
                        x={leaf.x0 + w / 2} y={leaf.y0 + h / 2 + (showSub ? -4 : 3)}
                        fill={fg} fontSize={Math.min(12, Math.max(8, w / 6))}
                        fontFamily="monospace" fontWeight={700}
                        textAnchor="middle" dominantBaseline="middle"
                        style={{ pointerEvents: 'none' }}
                      >
                        {leaf.data.ticker}
                      </text>
                    )}
                    {showSub && (
                      <text
                        x={leaf.x0 + w / 2} y={leaf.y0 + h / 2 + 10}
                        fill={fg} fontSize={Math.min(10, Math.max(7, w / 8))}
                        fontFamily="monospace"
                        textAnchor="middle" dominantBaseline="middle"
                        style={{ pointerEvents: 'none', opacity: 0.9 }}
                      >
                        {showPrice
                          ? `$${(leaf.data.price as number).toFixed(2)}`
                          : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
                      </text>
                    )}
                  </g>
                );
              })
            )}
          </svg>
        )}
      </div>

      {/* ── Tooltip ── */}
      {hoveredStock && (
        <div
          ref={tooltipRef}
          className="fixed pointer-events-none z-50 rounded-md"
          style={{
            background:     theme.tooltipBg,
            border:         `1px solid ${theme.tooltipBorder}`,
            boxShadow:      theme.tooltipShadow,
            padding:        '10px 14px',
            minWidth:       180,
            backdropFilter: 'blur(8px)',
            left:           tooltipPos.left,
            top:            tooltipPos.top,
          }}
        >
          <div style={{ color: theme.text, fontSize: 14, fontWeight: 700, fontFamily: 'monospace' }}>{hoveredStock.ticker}</div>
          <div style={{ color: theme.text, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{hoveredStock.name}</div>
          <div style={{ borderTop: `1px solid ${theme.headerBorder}`, margin: '6px 0' }} />
          {[
            { label: 'Price',      value: `$${hoveredStock.price.toFixed(2)}`,    color: theme.text },
            { label: 'Market Cap', value: `$${hoveredStock.mcap.toFixed(1)}B`,    color: theme.text },
            { label: 'Weight',     value: `${hoveredStock.weight.toFixed(2)}%`,   color: theme.text },
          ].map(row => (
            <div key={row.label} className="flex justify-between text-xs font-mono py-0.5" style={{ color: theme.subText }}>
              <span>{row.label}</span><span style={{ color: row.color }}>{row.value}</span>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${theme.headerBorder}`, margin: '6px 0' }} />
          {([
            { label: '1D', val: hoveredStock.changeDay   },
            { label: '1M', val: hoveredStock.changeMonth },
            { label: '1Y', val: hoveredStock.changeYear  },
          ] as const).map(row => (
            <div
              key={row.label}
              className="flex justify-between text-xs font-mono py-0.5"
              style={{ color: row.val >= 0 ? (isDark ? '#4ade80' : '#16a34a') : (isDark ? '#f87171' : '#dc2626') }}
            >
              <span>{row.label}</span>
              <span>{row.val >= 0 ? '+' : ''}{row.val.toFixed(2)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
