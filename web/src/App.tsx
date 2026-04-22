import { useState } from 'react';
import { TSXHeatmap } from './components/TSXHeatmap';
import { USHeatmap } from './components/USHeatmap';
import { TAB_LABELS, type TabId } from './config/tabs';
import { useDarkMode } from './hooks/useDarkMode';

const tabs: TabId[] = ['canHeatmap', 'usHeatmap'];

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>('canHeatmap');
  const isDark = useDarkMode();

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Tab Bar */}
      <div
        className="flex items-center gap-0 flex-shrink-0"
        style={{
          background: isDark ? '#0a0a0f' : '#f9fafb',
          borderBottom: `1px solid ${isDark ? '#1a1a2e' : '#e5e7eb'}`,
          paddingLeft: 16,
        }}
      >
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-medium transition-colors relative cursor-pointer ${
              activeTab === tab
                ? (isDark ? 'text-gray-100' : 'text-gray-900')
                : (isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600')
            }`}
          >
            {TAB_LABELS[tab]}
            {activeTab === tab && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-500 rounded-full" />
            )}
          </button>
        ))}

        <div className="ml-auto pr-4 flex items-center gap-2">
          <a
            href="https://github.com/pranberry/hoffman_heatmap"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs hover:underline"
            style={{ color: isDark ? '#666' : '#9ca3af' }}
          >
            Hoffman Heatmap
          </a>
        </div>
      </div>

      {/* Content */}
      {activeTab === 'canHeatmap' && <TSXHeatmap />}
      {activeTab === 'usHeatmap'  && <USHeatmap  />}
    </div>
  );
}
