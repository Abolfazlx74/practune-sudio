import React, { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX, RefreshCw, Hand } from 'lucide-react';
import { synth } from '../services/synth';

export type TimeSignatureType = '4/4' | '3/4' | '6/8' | '2/4';

export interface MetronomeGridState {
  enabled: boolean;
  bpm: number;
  timeSignature: TimeSignatureType;
  anchorTime: number;
}

interface SmartMetronomeProps {
  detectedBpm?: number;
  firstBeatTime?: number;
  isPlaying: boolean;
  currentTime: number;
  playbackSpeed?: number;
  defaultEnabled?: boolean;
  onGridChange?: (state: MetronomeGridState) => void;
}

const TIME_SIG_BEATS: Record<TimeSignatureType, number> = {
  '4/4': 4,
  '3/4': 3,
  '6/8': 6,
  '2/4': 2,
};

export const SmartMetronome: React.FC<SmartMetronomeProps> = ({
  detectedBpm = 120,
  firstBeatTime = 0,
  isPlaying,
  currentTime,
  playbackSpeed = 1.0,
  defaultEnabled = false,
  onGridChange,
}) => {
  const safeDetectedBpm =
    detectedBpm && detectedBpm >= 40 && detectedBpm <= 240
      ? Math.round(detectedBpm * 10) / 10
      : 120;

  const [enabled, setEnabled] = useState<boolean>(defaultEnabled);
  const [syncMode, setSyncMode] = useState<'auto' | 'manual'>('auto');
  const [manualBpm, setManualBpm] = useState<number>(Math.round(safeDetectedBpm));
  const [timeSignature, setTimeSignature] = useState<TimeSignatureType>('4/4');
  const [activeBeat, setActiveBeat] = useState<number>(-1);
  const [previewTick, setPreviewTick] = useState<boolean>(false);

  const lastBeatIndexRef = useRef<number | null>(null);
  const prevTimeRef = useRef<number>(0);
  const lastTriggerWallTimeRef = useRef<number>(0);
  const tapTimesRef = useRef<number[]>([]);
  const flashTimeoutRef = useRef<number | null>(null);

  const beatsPerBar = TIME_SIG_BEATS[timeSignature];
  const baseBpm = syncMode === 'auto' ? safeDetectedBpm : manualBpm;
  const effectiveBpm = Math.round(baseBpm * playbackSpeed * 10) / 10;
  const anchorTime = syncMode === 'auto' ? Math.max(0, firstBeatTime) : 0;

  // Sync manual BPM default when a new track loads
  useEffect(() => {
    setManualBpm(Math.round(safeDetectedBpm));
  }, [safeDetectedBpm]);

  // Notify parent canvas (e.g. PracticeStudio) so beat lines can be rendered
  useEffect(() => {
    onGridChange?.({
      enabled,
      bpm: baseBpm,
      timeSignature,
      anchorTime,
    });
  }, [enabled, baseBpm, timeSignature, anchorTime]);

  // Stop standalone preview automatically when main track starts playing
  useEffect(() => {
    if (isPlaying && previewTick) {
      setPreviewTick(false);
    }
  }, [isPlaying, previewTick]);

  // Trigger audio click + LED flash for a given beat index
  const triggerBeatPulse = (beatIndexInBar: number) => {
    const accent =
      beatIndexInBar === 0
        ? 'downbeat'
        : timeSignature === '6/8' && beatIndexInBar === 3
        ? 'secondary'
        : 'normal';

    synth.playMetronomeClick(accent);
    setActiveBeat(beatIndexInBar);

    if (flashTimeoutRef.current) {
      window.clearTimeout(flashTimeoutRef.current);
    }
    flashTimeoutRef.current = window.setTimeout(() => {
      setActiveBeat(-1);
    }, 130);
  };

  // Mode A: Synchronized playback tracking (locks to audio timeline & loop restarts cleanly)
  useEffect(() => {
    if (!enabled || !isPlaying) {
      lastBeatIndexRef.current = null;
      prevTimeRef.current = currentTime;
      return;
    }

    // Detect backward loop jump or seek so beat counter resets cleanly
    if (currentTime < prevTimeRef.current - 0.15) {
      lastBeatIndexRef.current = null;
    }
    prevTimeRef.current = currentTime;

    const trackTimeBeatDur =
      syncMode === 'auto'
        ? 60.0 / Math.max(30, baseBpm)
        : (60.0 / Math.max(30, manualBpm)) * playbackSpeed;

    const relTime = currentTime - anchorTime;
    if (relTime < -0.005) {
      lastBeatIndexRef.current = null;
      return;
    }

    const currentBeatCounter = Math.max(0, Math.floor((relTime + 0.002) / trackTimeBeatDur));

    if (lastBeatIndexRef.current !== currentBeatCounter) {
      const nowPerf = performance.now();
      const wallBeatMs = (trackTimeBeatDur / Math.max(0.25, playbackSpeed)) * 1000;
      const minGapMs = wallBeatMs * 0.55;

      // Prevent duplicate click at exact loop-end boundary right before wrap to 0
      if (nowPerf - lastTriggerWallTimeRef.current >= minGapMs) {
        lastBeatIndexRef.current = currentBeatCounter;
        lastTriggerWallTimeRef.current = nowPerf;
        const beatInBar = ((currentBeatCounter % beatsPerBar) + beatsPerBar) % beatsPerBar;
        triggerBeatPulse(beatInBar);
      } else {
        lastBeatIndexRef.current = currentBeatCounter;
      }
    }
  }, [enabled, isPlaying, currentTime, syncMode, baseBpm, manualBpm, playbackSpeed, anchorTime, beatsPerBar, timeSignature]);

  // Mode B: Standalone Audition Preview when track is paused
  useEffect(() => {
    if (!enabled || isPlaying || !previewTick) return;

    let step = 0;
    triggerBeatPulse(0);
    const intervalMs = (60.0 / Math.max(30, effectiveBpm)) * 1000;

    const timer = window.setInterval(() => {
      step = (step + 1) % beatsPerBar;
      triggerBeatPulse(step);
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, isPlaying, previewTick, effectiveBpm, beatsPerBar, timeSignature]);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
    };
  }, []);

  // Tap Tempo handler
  const handleTapTempo = () => {
    const now = performance.now();
    const taps = tapTimesRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) {
      tapTimesRef.current = [];
    }
    tapTimesRef.current.push(now);
    if (tapTimesRef.current.length > 5) {
      tapTimesRef.current.shift();
    }
    if (tapTimesRef.current.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < tapTimesRef.current.length; i++) {
        intervals.push(tapTimesRef.current[i] - tapTimesRef.current[i - 1]);
      }
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const tappedBpm = Math.max(40, Math.min(240, Math.round(60000 / avgMs)));
      setSyncMode('manual');
      setManualBpm(tappedBpm);
      if (!enabled) setEnabled(true);
    }
    synth.playMetronomeClick('downbeat');
  };

  return (
    <div className="daw-panel p-3.5 px-4 border border-slate-800 bg-slate-900/60 rounded-2xl flex flex-wrap items-center justify-between gap-3">
      {/* Left: Toggle + Blinking Beat LEDs */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            setEnabled((prev) => {
              const next = !prev;
              if (!next) setPreviewTick(false);
              return next;
            });
          }}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs font-bold transition-all ${
            enabled
              ? 'bg-amber-950/70 border-amber-500/70 text-amber-300 shadow-md shadow-amber-500/15'
              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
          title={enabled ? 'Disable Smart Metronome' : 'Enable Smart Metronome'}
        >
          {enabled ? <Volume2 className="w-3.5 h-3.5 text-amber-400" /> : <VolumeX className="w-3.5 h-3.5" />}
          <span>Metronome: {enabled ? 'ON' : 'OFF'}</span>
        </button>

        {/* Blinking Beat Indicator LEDs */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800/90">
          {Array.from({ length: beatsPerBar }).map((_, idx) => {
            const isLit = enabled && activeBeat === idx;
            const isDownbeat = idx === 0;
            return (
              <div
                key={idx}
                className={`w-5 h-5 rounded-full flex items-center justify-center font-mono text-[10px] font-bold transition-all duration-75 ${
                  isLit
                    ? isDownbeat
                      ? 'bg-emerald-400 text-slate-950 scale-115 shadow-[0_0_12px_rgba(52,211,153,0.9)]'
                      : 'bg-cyan-400 text-slate-950 scale-110 shadow-[0_0_10px_rgba(34,211,238,0.85)]'
                    : isDownbeat
                    ? 'bg-slate-900 border border-amber-500/40 text-amber-400/80'
                    : 'bg-slate-900 border border-slate-800 text-slate-500'
                }`}
              >
                {idx + 1}
              </div>
            );
          })}
        </div>

        {/* Time Signature Selector */}
        <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-xl">
          {(['4/4', '3/4', '6/8', '2/4'] as TimeSignatureType[]).map((sig) => (
            <button
              key={sig}
              onClick={() => setTimeSignature(sig)}
              className={`px-2 py-0.5 rounded-lg text-[11px] font-mono font-bold transition-all ${
                timeSignature === sig
                  ? 'bg-cyan-950 border border-cyan-700/60 text-cyan-300'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {sig}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Auto-Sync vs Manual BPM + Tap Tempo + Preview */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Auto / Manual Switcher */}
        <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-xl">
          <button
            onClick={() => setSyncMode('auto')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
              syncMode === 'auto'
                ? 'bg-emerald-950/70 border border-emerald-600/60 text-emerald-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Automatically syncs to track BPM and first note onset"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Auto ({safeDetectedBpm} BPM)</span>
          </button>
          <button
            onClick={() => setSyncMode('manual')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
              syncMode === 'manual'
                ? 'bg-cyan-950 border border-cyan-700/60 text-cyan-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Manual
          </button>
        </div>

        {/* Manual BPM Adjuster */}
        {syncMode === 'manual' ? (
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-2 py-1 rounded-xl">
            <button
              onClick={() => setManualBpm((b) => Math.max(40, b - 2))}
              className="w-5 h-5 flex items-center justify-center rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold"
            >
              -
            </button>
            <span className="text-xs font-mono font-bold text-cyan-400 min-w-16 text-center">
              {effectiveBpm} BPM
            </span>
            <button
              onClick={() => setManualBpm((b) => Math.min(240, b + 2))}
              className="w-5 h-5 flex items-center justify-center rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold"
            >
              +
            </button>
          </div>
        ) : (
          <div className="px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300">
            Active: <strong className="text-emerald-400">{effectiveBpm}</strong> BPM
          </div>
        )}

        {/* Tap Tempo Button */}
        <button
          onClick={handleTapTempo}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-amber-300 transition-all"
          title="Tap repeatedly to set custom tempo"
        >
          <Hand className="w-3.5 h-3.5 text-amber-400" />
          <span>Tap</span>
        </button>

        {/* Audition Click when paused */}
        {enabled && !isPlaying && (
          <button
            onClick={() => setPreviewTick((p) => !p)}
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition-all ${
              previewTick
                ? 'bg-cyan-950 border-cyan-600 text-cyan-300 animate-pulse'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {previewTick ? 'Stop Click' : 'Test Click'}
          </button>
        )}
      </div>
    </div>
  );
};