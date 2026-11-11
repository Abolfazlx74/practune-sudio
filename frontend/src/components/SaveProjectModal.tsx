import React, { useState, useEffect } from 'react';
import { Save, Copy, Edit3, X, Check } from 'lucide-react';

interface SaveProjectModalProps {
  isOpen: boolean;
  mode: 'save' | 'saveAs' | 'rename';
  initialName?: string;
  onConfirm: (name: string) => void;
  onClose: () => void;
}

export const SaveProjectModal: React.FC<SaveProjectModalProps> = ({
  isOpen,
  mode,
  initialName = '',
  onConfirm,
  onClose,
}) => {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      const original = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [isOpen, initialName]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onConfirm(name.trim());
    }
  };

  const title =
    mode === 'saveAs'
      ? 'Save Project As'
      : mode === 'rename'
      ? 'Rename Project'
      : 'Save Project';

  const confirmLabel =
    mode === 'saveAs'
      ? 'Save Copy'
      : mode === 'rename'
      ? 'Rename'
      : 'Save Project';

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="daw-panel max-w-md w-full p-6 border border-slate-800 bg-slate-900/95 shadow-2xl rounded-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-700/60 text-cyan-400">
              {mode === 'saveAs' ? (
                <Copy className="w-4 h-4" />
              ) : mode === 'rename' ? (
                <Edit3 className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">{title}</h3>
              <p className="text-[11px] text-slate-400">
                {mode === 'saveAs'
                  ? 'Create an independent project copy'
                  : 'Enter a name for this practice project'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Project Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Vocal Arpeggio Master"
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-cyan-500 focus:outline-hidden text-sm text-slate-100 placeholder:text-slate-600 transition-all font-medium"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700/60 text-xs font-semibold transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>{confirmLabel}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
