import React, { useEffect } from 'react';
import { Award, CheckCircle, XCircle, ArrowRight, RotateCcw, AlertTriangle } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { EvaluationResponse } from '../types';

interface EvaluationModalProps {
  evaluation: EvaluationResponse;
  onClose: () => void;
  onRetry: () => void;
}

export const EvaluationModal: React.FC<EvaluationModalProps> = ({
  evaluation,
  onClose,
  onRetry,
}) => {
  useEffect(() => {
    if (evaluation.overall_score >= 70) {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#06b6d4', '#38bdf8', '#10b981', '#f59e0b'],
      });
    }
  }, [evaluation.overall_score]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-400 border-emerald-500/50 bg-emerald-950/40';
    if (score >= 60) return 'text-amber-400 border-amber-500/50 bg-amber-950/40';
    return 'text-rose-400 border-rose-500/50 bg-rose-950/40';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="daw-panel max-w-2xl w-full p-6 border border-slate-700/80 bg-slate-900 shadow-2xl rounded-3xl space-y-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-cyan-950 border border-cyan-800/60 text-cyan-400">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Performance Evaluation</h2>
              <p className="text-xs text-slate-400">Real-time pitch and timing analysis report</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-sm"
          >
            ✕
          </button>
        </div>

        {/* Overall Score Badge */}
        <div className="flex flex-col items-center justify-center py-4 bg-slate-950/60 border border-slate-800/80 rounded-2xl">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
            Overall Match Score
          </span>
          <div className={`text-5xl font-black tracking-tight font-mono px-6 py-2 rounded-2xl border ${getScoreColor(evaluation.overall_score)}`}>
            {evaluation.overall_score}%
          </div>
          <p className="text-xs text-slate-400 mt-2 font-medium">
            {evaluation.overall_score >= 80 ? 'Mastery Level' : evaluation.overall_score >= 60 ? 'Proficient' : 'Developing'}
          </p>
        </div>

        {/* Sub-Metrics Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-center space-y-1">
            <span className="text-[11px] text-slate-400 font-medium">Pitch Accuracy</span>
            <div className="text-xl font-bold font-mono text-cyan-400">
              {evaluation.pitch_accuracy}%
            </div>
            <span className="text-[10px] text-slate-400">±50 cents tolerance</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-center space-y-1">
            <span className="text-[11px] text-slate-400 font-medium">Timing Accuracy</span>
            <div className="text-xl font-bold font-mono text-indigo-400">
              {evaluation.timing_accuracy}%
            </div>
            <span className="text-[10px] text-slate-400">Onset alignment</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-center space-y-1">
            <span className="text-[11px] text-slate-400 font-medium">Note Sequence</span>
            <div className="text-xl font-bold font-mono text-emerald-400">
              {evaluation.sequence_accuracy}%
            </div>
            <span className="text-[10px] text-slate-400">Melodic continuity</span>
          </div>
        </div>

        {/* Actionable Feedback */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Targeted Musical Feedback:
          </h4>
          <div className="space-y-1.5">
            {evaluation.feedback.map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/70 text-xs text-slate-300"
              >
                <div className="mt-0.5 text-cyan-400 font-bold">•</div>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Per-Note Breakdown Table */}
        {evaluation.note_scores.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Note-by-Note Breakdown:
            </h4>
            <div className="max-h-40 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950/70">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-medium">
                  <tr>
                    <th className="p-2">Target</th>
                    <th className="p-2">Time</th>
                    <th className="p-2">Avg Deviation</th>
                    <th className="p-2">Status</th>
                    <th className="p-2 text-right">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {evaluation.note_scores.map((ns) => (
                    <tr key={ns.note_id} className="hover:bg-slate-900/40">
                      <td className="p-2 font-bold text-slate-200">{ns.target_note}</td>
                      <td className="p-2 text-slate-400">{ns.start.toFixed(1)}s - {ns.end.toFixed(1)}s</td>
                      <td className="p-2">
                        {ns.user_avg_cents_error > 0 ? `+${ns.user_avg_cents_error}` : ns.user_avg_cents_error} cents
                      </td>
                      <td className="p-2">
                        {ns.is_hit ? (
                          <span className="flex items-center gap-1 text-emerald-400">
                            <CheckCircle className="w-3 h-3" /> Hit
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-rose-400">
                            <XCircle className="w-3 h-3" /> Missed
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-right font-bold text-slate-200">{ns.score}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 rounded-xl text-xs font-semibold transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Practice Again
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-semibold rounded-xl text-xs shadow-md transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
