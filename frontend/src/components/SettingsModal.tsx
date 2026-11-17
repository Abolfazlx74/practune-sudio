import React, { useState, useEffect } from 'react';
import { Settings, Cpu, Check, Piano, Mic2, Sparkles } from 'lucide-react';

interface SettingsModalProps {
  centsTolerance: number;
  setCentsTolerance: (val: number) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  centsTolerance,
  setCentsTolerance,
}) => {
  const [tolerance, setTolerance] = useState(centsTolerance);
  const [instrumentEngine, setInstrumentEngine] = useState<'basic_pitch' | 'yin'>('basic_pitch');
  const [vocalEngine, setVocalEngine] = useState<'yin' | 'basic_pitch'>('yin');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const savedInst = localStorage.getItem('practune_instrument_engine');
    if (savedInst === 'yin' || savedInst === 'basic_pitch') {
      setInstrumentEngine(savedInst);
    }
    const savedVocal = localStorage.getItem('practune_vocal_engine');
    if (savedVocal === 'yin' || savedVocal === 'basic_pitch') {
      setVocalEngine(savedVocal);
    }
  }, []);

  const handleSave = () => {
    setCentsTolerance(tolerance);
    localStorage.setItem('practune_instrument_engine', instrumentEngine);
    localStorage.setItem('practune_vocal_engine', vocalEngine);
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
            <p className="text-xs text-slate-400">Configure transcription inference models, DSP thresholds, and scoring metrics</p>
          </div>
        </div>

        {/* AI & DSP Transcription Engine Preferences */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <Sparkles className="w-4 h-4 text-amber-400" />
            Transcription Engines (AI Neural & DSP)
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Instrument Model Selection */}
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
                  <Piano className="w-3.5 h-3.5" />
                  Instrument Transcription:
                </span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-400">
                  Default: Basic Pitch
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setInstrumentEngine('basic_pitch')}
                  className={`flex flex-col text-left p-2.5 rounded-lg border text-xs transition-all ${
                    instrumentEngine === 'basic_pitch'
                      ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200 shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="font-semibold flex items-center justify-between">
                    Spotify Basic Pitch (AI)
                    {instrumentEngine === 'basic_pitch' && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-0.5">
                    Recommended for chords, polyphonic guitar/piano, and discrete note bends.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setInstrumentEngine('yin')}
                  className={`flex flex-col text-left p-2.5 rounded-lg border text-xs transition-all ${
                    instrumentEngine === 'yin'
                      ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200 shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="font-semibold flex items-center justify-between">
                    DSP YIN & Onset Tracker
                    {instrumentEngine === 'yin' && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-0.5">
                    Traditional monophonic signal processor for single-lead instruments.
                  </span>
                </button>
              </div>
            </div>

            {/* Vocal Model Selection */}
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                  <Mic2 className="w-3.5 h-3.5" />
                  Vocal Transcription:
                </span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-400">
                  Default: YIN
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setVocalEngine('yin')}
                  className={`flex flex-col text-left p-2.5 rounded-lg border text-xs transition-all ${
                    vocalEngine === 'yin'
                      ? 'bg-emerald-950/60 border-emerald-500 text-emerald-200 shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="font-semibold flex items-center justify-between">
                    DSP YIN & Vibrato Tracker
                    {vocalEngine === 'yin' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-0.5">
                    Recommended for voice: captures continuous pitch contour, microtones & vibrato.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setVocalEngine('basic_pitch')}
                  className={`flex flex-col text-left p-2.5 rounded-lg border text-xs transition-all ${
                    vocalEngine === 'basic_pitch'
                      ? 'bg-emerald-950/60 border-emerald-500 text-emerald-200 shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="font-semibold flex items-center justify-between">
                    Spotify Basic Pitch (Experimental)
                    {vocalEngine === 'basic_pitch' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-0.5">
                    Segmented discrete notes for fast vocal melodies or rhythmic vocal phrasing.
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Practice Tolerance Settings */}
        <div className="space-y-4 pt-2 border-t border-slate-800/80">
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
