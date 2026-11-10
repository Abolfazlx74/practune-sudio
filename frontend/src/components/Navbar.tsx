import React from 'react';
import { Music2, Sliders, Mic2, Library, Sparkles, Settings as SettingsIcon } from 'lucide-react';

export type TabType = 'dashboard' | 'workspace' | 'visualization' | 'practice' | 'settings';

interface NavbarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  hasAudio: boolean;
  hasTranscription: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  hasAudio,
  hasTranscription,
}) => {
  return (
    <header className="h-16 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40 px-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
          <Music2 className="w-5 h-5 text-white" />
        </div>
        <div>
          <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-cyan-400 bg-clip-text text-transparent">
            Practune Studio
          </span>
          <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-950 border border-cyan-700/50 text-cyan-300">
            AI MVP
          </span>
        </div>
      </div>

      <nav className="flex items-center gap-1 bg-slate-900/90 border border-slate-800/80 p-1 rounded-xl">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'dashboard'
              ? 'bg-slate-800 text-cyan-400 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          <Library className="w-4 h-4" />
          Dashboard
        </button>

        <button
          onClick={() => setActiveTab('workspace')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'workspace'
              ? 'bg-slate-800 text-cyan-400 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          <Sliders className="w-4 h-4" />
          Audio Workspace
          {hasAudio && <span className="w-2 h-2 rounded-full bg-emerald-400"></span>}
        </button>

        <button
          onClick={() => setActiveTab('visualization')}
          disabled={!hasTranscription}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'visualization'
              ? 'bg-slate-800 text-cyan-400 shadow-sm'
              : hasTranscription
              ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              : 'text-slate-600 cursor-not-allowed opacity-60'
          }`}
          title={!hasTranscription ? 'Transcribe audio first to view' : ''}
        >
          <Sparkles className="w-4 h-4" />
          Analysis & Visualizer
          {hasTranscription && <span className="w-2 h-2 rounded-full bg-cyan-400"></span>}
        </button>

        <button
          onClick={() => setActiveTab('practice')}
          disabled={!hasTranscription}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'practice'
              ? 'bg-slate-800 text-cyan-400 shadow-sm'
              : hasTranscription
              ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              : 'text-slate-600 cursor-not-allowed opacity-60'
          }`}
          title={!hasTranscription ? 'Transcribe audio first to practice' : ''}
        >
          <Mic2 className="w-4 h-4" />
          Practice Studio
          {hasTranscription && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>}
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`p-1.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'settings'
              ? 'bg-slate-800 text-cyan-400 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
          title="Studio Settings"
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
      </nav>
    </header>
  );
};
