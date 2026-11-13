import React, { useEffect } from 'react';
import { Award, CheckCircle, XCircle, ArrowRight, RotateCcw, X } from 'lucide-react';
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

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [evaluation.overall_score, onClose]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-400 border-emerald-500/50 bg-emerald-950/40';
    if (score >= 60) return 'text-amber-400 border-amber-500/50 bg-amber-950/40';
    return 'text-rose-400 border-rose-500/50 bg-rose-950/40';
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-container">
        {/* Pinned Sticky Header */}
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-800/60 text-cyan-400">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Performance Evaluation</h2>
              <p className="text-xs text-slate-400">Practice session pitch and timing results</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl bg-slate-800 hover:bg-slate-700 transition-colors"
            title="Close modal (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="modal-body">
          {/* Overall Score Badge */}
          <div className="flex flex-col items-center justify-center py-4 bg-slate-950/80 border border-slate-800/80 rounded-2xl">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
              Overall Match Score
            </span>
            <div className={`text-4xl sm:text-5xl font-black tracking-tight font-mono px-6 py-2 rounded-2xl border ${getScoreColor(evaluation.overall_score)}`}>
              {evaluation.overall_score}%
            </div>
            <p className="text-xs text-slate-400 mt-2 font-medium">
              {evaluation.overall_score >= 80 ? 'Mastery Level' : evaluation.overall_score >= 60 ? 'Proficient' : 'Developing'}
            </p>
          </div>

          {/* Sub-Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-1">
              <span className="text-[11px] text-slate-400 font-medium">Pitch Accuracy</span>
              <div className="text-xl font-bold font-mono text-cyan-400">
                {evaluation.pitch_accuracy}%
              </div>
              <span className="text-[10px] text-slate-500">Cents tolerance</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-1">
              <span className="text-[11px] text-slate-400 font-medium">Timing Accuracy</span>
              <div className="text-xl font-bold font-mono text-indigo-400">
                {evaluation.timing_accuracy}%
              </div>
              <span className="text-[10px] text-slate-500">Onset alignment</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-1">
              <span className="text-[11px] text-slate-400 font-medium">Note Coverage</span>
              <div className="text-xl font-bold font-mono text-teal-400">
                {evaluation.note_coverage ?? 100}%
              </div>
              <span className="text-[10px] text-slate-500">Notes captured</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-1">
              <span className="text-[11px] text-slate-400 font-medium">Note Sequence</span>
              <div className="text-xl font-bold font-mono text-emerald-400">
                {evaluation.sequence_accuracy}%
              </div>
              <span className="text-[10px] text-slate-500">Melodic order</span>
            </div>
          </div>

          {/* Diagnostic Transparency Pill */}
          {evaluation.alignment_offset_ms !== undefined && (
            <div className="px-3 py-1.5 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2 font-mono">
              <span>Latency Offset: <strong className="text-cyan-400">{evaluation.alignment_offset_ms > 0 ? `+${evaluation.alignment_offset_ms}` : evaluation.alignment_offset_ms}ms</strong></span>
              <span>Avg Cents Deviation: <strong className="text-amber-400">±{evaluation.avg_cents_error ?? 0}¢</strong></span>
              <span>Missed Notes: <strong className={evaluation.missed_notes_count ? "text-rose-400" : "text-emerald-400"}>{evaluation.missed_notes_count ?? 0}</strong></span>
              <span>Extra Notes: <strong className={evaluation.extra_notes_count ? "text-amber-400" : "text-slate-400"}>{evaluation.extra_notes_count ?? 0}</strong></span>
            </div>
          )}

          {/* Actionable Musical Feedback */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Targeted Musical Feedback:
            </h4>
            <div className="space-y-1.5">
              {evaluation.feedback.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 text-xs text-slate-300"
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
                Note-by-Note Analysis:
              </h4>
              <div className="overflow-hidden border border-slate-800 rounded-xl bg-slate-950">
                <table className="eval-table">
                  <thead>
                    <tr>
                      <th>Target</th>
                      <th>Time</th>
                      <th>Avg Deviation</th>
                      <th>Status</th>
                      <th className="text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluation.note_scores.map((ns) => (
                      <tr key={ns.note_id}>
                        <td className="font-bold text-slate-200">{ns.target_note}</td>
                        <td className="text-slate-400">{ns.start.toFixed(1)}s - {ns.end.toFixed(1)}s</td>
                        <td>
                          {ns.user_avg_cents_error > 0 ? `+${ns.user_avg_cents_error}` : ns.user_avg_cents_error}¢
                        </td>
                        <td>
                          {ns.is_hit ? (
                            <span className="flex items-center gap-1 text-emerald-400">
                              <CheckCircle className="w-3.5 h-3.5" /> Hit
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-rose-400">
                              <XCircle className="w-3.5 h-3.5" /> Missed
                            </span>
                          )}
                        </td>
                        <td className="text-right font-bold text-slate-200">{ns.score}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Pinned Sticky Footer */}
        <div className="modal-footer">
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 rounded-xl text-xs font-semibold transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
            Practice Again
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold rounded-xl text-xs shadow-md transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
