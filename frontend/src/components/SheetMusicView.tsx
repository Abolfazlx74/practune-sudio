import React, { useEffect, useRef, useState } from 'react';
import { FileText, Download, Music, AlertCircle } from 'lucide-react';
import type { NoteItem, TranscriptionResult } from '../types';

interface SheetMusicViewProps {
  transcription: TranscriptionResult;
  currentTime: number;
}

export const SheetMusicView: React.FC<SheetMusicViewProps> = ({
  transcription,
  currentTime,
}) => {
  const osmdContainerRef = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRendered, setIsRendered] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let osmdInstance: any = null;

    async function loadOsmd() {
      if (!osmdContainerRef.current) return;
      try {
        setLoadError(null);
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');

        // Fetch MusicXML from backend
        const xmlRes = await fetch(`/api/audio/${transcription.audio_id}/export/musicxml`, {
          method: 'POST',
        });
        if (!xmlRes.ok) throw new Error('Could not fetch MusicXML from backend');
        const xmlText = await xmlRes.text();

        if (!isMounted || !osmdContainerRef.current) return;
        osmdContainerRef.current.innerHTML = '';

        osmdInstance = new OpenSheetMusicDisplay(osmdContainerRef.current, {
          autoResize: true,
          backend: 'svg',
          drawTitle: true,
          drawSubtitle: false,
          drawingParameters: 'compact',
          defaultColorMusic: '#e2e8f0',
        });

        await osmdInstance.load(xmlText);
        osmdInstance.render();
        if (isMounted) setIsRendered(true);
      } catch (err: any) {
        console.warn('OSMD standard render notice:', err);
        if (isMounted) setLoadError(err.message || 'Sheet notation renderer initialized in vector mode');
      }
    }

    loadOsmd();

    return () => {
      isMounted = false;
      if (osmdContainerRef.current) osmdContainerRef.current.innerHTML = '';
    };
  }, [transcription.audio_id]);

  const activeNote = transcription.notes.find(
    (n) => currentTime >= n.start && currentTime <= n.end
  );

  return (
    <div className="daw-panel p-6 border border-slate-800 bg-slate-900/50 rounded-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-slate-200">Musical Score (Sheet Music)</span>
          {activeNote && (
            <span className="ml-3 text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-300 font-mono animate-pulse">
              Active Note: {activeNote.note_name} ({activeNote.duration}s)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/api/audio/${transcription.audio_id}/export/musicxml`}
            download={`${transcription.audio_id}.musicxml`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700/60 text-xs font-semibold transition-all shadow-sm"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            Download MusicXML
          </a>
        </div>
      </div>

      {/* OSMD Music Score Container */}
      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 min-h-[220px] flex items-center justify-center overflow-x-auto">
        <div ref={osmdContainerRef} className="w-full text-slate-100" />

        {loadError && (
          /* Clean Interactive Vector Staff Fallback */
          <div className="w-full py-4 space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Music className="w-3.5 h-3.5 text-cyan-400" />
                Treble Clef Transcription (4/4 • {transcription.bpm || 120} BPM)
              </span>
              <span>{transcription.notes.length} Notes Placed</span>
            </div>

            {/* SVG Five-Line Staff */}
            <svg className="w-full h-36 bg-slate-900/60 rounded-xl border border-slate-800 p-2" viewBox="0 0 800 120">
              {/* 5 Staff lines */}
              {[30, 45, 60, 75, 90].map((y, idx) => (
                <line key={idx} x1="20" y1={y} x2="780" y2={y} stroke="#475569" strokeWidth="1.2" />
              ))}

              {/* Treble Clef Symbol representation */}
              <text x="30" y="80" fill="#94a3b8" fontSize="48" fontFamily="serif">𝄞</text>

              {/* Key & Time Signature */}
              <text x="65" y="55" fill="#cbd5e1" fontSize="18" fontWeight="bold">4</text>
              <text x="65" y="85" fill="#cbd5e1" fontSize="18" fontWeight="bold">4</text>

              {/* Render notes on staff */}
              {transcription.notes.slice(0, 16).map((n, idx) => {
                const isCurrent = currentTime >= n.start && currentTime <= n.end;
                const x = 110 + idx * 40;
                // Staff line calculation: C4 (60) is below staff (y=105 with ledger), E4=90, G4=75, B4=60, D5=45, F5=30
                const notePitchOffset = (n.midi - 60) * 3.75;
                const noteY = Math.max(15, Math.min(105, 105 - notePitchOffset));

                return (
                  <g key={n.id}>
                    {/* Ledger line for Middle C or low notes */}
                    {noteY >= 100 && (
                      <line x1={x - 8} y1="105" x2={x + 8} y2="105" stroke="#64748b" strokeWidth="1" />
                    )}
                    {/* Notehead */}
                    <ellipse
                      cx={x}
                      cy={noteY}
                      rx="6"
                      ry="4.5"
                      fill={isCurrent ? '#38bdf8' : '#e2e8f0'}
                      stroke={isCurrent ? '#0284c7' : '#94a3b8'}
                      strokeWidth="1.5"
                      transform={`rotate(-20 ${x} ${noteY})`}
                    />
                    {/* Stem */}
                    <line
                      x1={x + 5}
                      y1={noteY}
                      x2={x + 5}
                      y2={noteY - 26}
                      stroke={isCurrent ? '#38bdf8' : '#e2e8f0'}
                      strokeWidth="1.5"
                    />
                    {/* Note name tag */}
                    <text
                      x={x - 4}
                      y={noteY + 16}
                      fill={isCurrent ? '#38bdf8' : '#64748b'}
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      {n.note_name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};
