import React, { useState } from 'react';
import { Sliders, Sparkles, RefreshCw, Check, ArrowLeftRight } from 'lucide-react';
import type { CorrectionOptions, TranscriptionResult } from '../types';
import { correctPitch } from '../services/api';

interface PitchCorrectionControlsProps {
  audioId: string;
  originalTranscription: TranscriptionResult;
  currentTranscription: TranscriptionResult;
  onTranscriptionUpdate: (updated: TranscriptionResult) => void;
}

export const PitchCorrectionControls: React.FC<PitchCorrectionControlsProps> = ({
  audioId,
  originalTranscription,
  currentTranscription,
  onTranscriptionUpdate,
}) => {
  const [centerStrength, setCenterStrength] = useState(0.7);
  const [variationReduction, setVariationReduction] = useState(0.6);
  const [isApplying, setIsApplying] = useState(false);
  const [isShowingSimplified, setIsShowingSimplified] = useState(false);

  const handleApplyCorrection = async () => {
    setIsApplying(true);
    try {
      const opts: CorrectionOptions = {
        pitch_center_strength: centerStrength,
        pitch_variation_reduction: variationReduction,
      };
      const result = await correctPitch(audioId, opts);
      onTranscriptionUpdate(result);
      setIsShowingSimplified(true);
    } catch (err: any) {
      alert(`Correction error: ${err.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleToggleOriginalSimplified = () => {
    if (isShowingSimplified) {
      // Revert to original
      onTranscriptionUpdate(originalTranscription);
      setIsShowingSimplified(false);
    } else {
      // Apply current simplification
      handleApplyCorrection();
    }
  };

  return (
    <div className="daw-panel p-5 border border-slate-800 bg-slate-900/60 rounded-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-slate-200">
            Melody Simplification & Pitch Center (FL Studio NewTone)
          </h3>
        </div>

        {/* Non-destructive A/B Comparison Toggle */}
        <button
          onClick={handleToggleOriginalSimplified}
          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
            isShowingSimplified
              ? 'bg-emerald-950/80 border-emerald-700/60 text-emerald-300'
              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          {isShowingSimplified ? 'Showing: Simplified Melody' : 'Showing: Raw Transcription'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
        {/* Pitch Center Snap Slider */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="font-medium text-slate-300">Pitch Center Snap</span>
            <span className="text-emerald-400 font-mono">{Math.round(centerStrength * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={centerStrength}
            onChange={(e) => setCenterStrength(parseFloat(e.target.value))}
            className="w-full accent-emerald-400"
          />
          <p className="text-[11px] text-slate-400">
            Attracts detected pitches toward nearest semitones to eliminate microtonal drift.
          </p>
        </div>

        {/* Pitch Variation / Vibrato Reduction Slider */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="font-medium text-slate-300">Pitch Variation (Vibrato)</span>
            <span className="text-emerald-400 font-mono">{Math.round(variationReduction * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={variationReduction}
            onChange={(e) => setVariationReduction(parseFloat(e.target.value))}
            className="w-full accent-emerald-400"
          />
          <p className="text-[11px] text-slate-400">
            Smooths out vocal vibrato and pitch jitter within sustained notes for clearer melody.
          </p>
        </div>

        {/* Action Button */}
        <div>
          <button
            onClick={handleApplyCorrection}
            disabled={isApplying}
            className="w-full py-2.5 bg-slate-800 hover:bg-slate-750 text-emerald-300 border border-emerald-700/50 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-sm"
          >
            {isApplying ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Smoothing Pitch...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                Apply Melody Smoothing
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
