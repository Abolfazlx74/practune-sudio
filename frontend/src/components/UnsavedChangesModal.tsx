import React, { useEffect } from 'react';
import { AlertCircle, Save, Trash2, X } from 'lucide-react';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  projectName?: string;
  onSaveAndContinue: () => void;
  onDiscardAndContinue: () => void;
  onCancel: () => void;
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
  isOpen,
  projectName = 'Current Project',
  onSaveAndContinue,
  onDiscardAndContinue,
  onCancel,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="daw-panel max-w-md w-full p-6 border border-slate-800 bg-slate-900/95 shadow-2xl rounded-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-amber-950/60 border border-amber-700/60 text-amber-400 shrink-0">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-white tracking-tight">
              Unsaved Changes
            </h3>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              You have unsaved changes in <span className="font-semibold text-cyan-300">"{projectName}"</span>.
              Loading a different audio file will replace your current workspace.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          {/* Action 1: Save Current Project */}
          <button
            onClick={onSaveAndContinue}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold rounded-xl text-xs shadow-md transition-all cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>Save Current Project</span>
          </button>

          {/* Action 2: Discard Changes */}
          <button
            onClick={onDiscardAndContinue}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-750 text-rose-400 border border-slate-700/60 font-semibold rounded-xl text-xs transition-all cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Discard Changes</span>
          </button>

          {/* Action 3: Cancel */}
          <button
            onClick={onCancel}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700/60 font-semibold rounded-xl text-xs transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
            <span>Cancel</span>
          </button>
        </div>
      </div>
    </div>
  );
};
