import React, { useState } from 'react';
import { Settings, Cpu, Sliders, Check } from 'lucide-react';

interface SettingsModalProps {
  centsTolerance: number;
  setCentsTolerance: (val: number) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  centsTolerance,
  setCentsTolerance,
}) => {
  const [tolerance, setTolerance] = useState(centsTolerance);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setCentsTolerance(tolerance);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-4">
      <div className="daw-panel p-6 border border-slate-800 bg-slate-900/60 rounded-2xl shadow-xl space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-800">
          <div className="p-3 rounded-2xl bg-cyan-950 border border-cyan-800/60 text-cyan-400">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Studio Engine & Practice Settings</h2>
            <p className="text-xs text-slate-400">Configure DSP thresholds and performance scoring metrics</p>
          </div>
        </div>

        {/* Practice Tolerance Settings */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="font-semibold text-slate-300">Pitch Practice Tolerance</span>
              <span className="text-cyan-400 font-mono font-bold">±{tolerance} Cents</span>
            </div>
            <input
              type="range"
              min={20}
              max={80}
              step={5}
              value={tolerance}
              onChange={(e) => setTolerance(parseInt(e.target.value))}
              className="w-full accent-cyan-400"
            />
            <p className="text-xs text-slate-400">
              Tolerance boundary within which sung notes are counted as in-tune "hits". 50 cents = 1/4 semitone.
            </p>
          </div>
        </div>

        {/* Engine Information */}
        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <Cpu className="w-4 h-4 text-cyan-400" />
            Transcription & Pitch Engine Status
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-0.5">
              <span className="text-slate-400 text-[11px]">Primary Transcription:</span>
              <p className="font-semibold text-slate-200">Spotify Basic Pitch & YIN Hybrid</p>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-0.5">
              <span className="text-slate-400 text-[11px]">Live Vocal Pitch Tracker:</span>
              <p className="font-semibold text-emerald-400">Client-Side Web Audio YIN (60 FPS)</p>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-0.5">
              <span className="text-slate-400 text-[11px]">DSP Preprocessing:</span>
              <p className="font-semibold text-slate-200">Stationary Spectral Gating & Peak Norm</p>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-0.5">
              <span className="text-slate-400 text-[11px]">Audio File Serving:</span>
              <p className="font-semibold text-slate-200">FastAPI Local Streaming Engine</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold rounded-xl text-xs shadow-md transition-all"
          >
            {saved ? (
              <>
                <Check className="w-4 h-4 text-emerald-950" />
                Saved!
              </>
            ) : (
              'Save Preferences'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
