import React, { useState } from 'react';
import {
  Piano,
  FileText,
  Activity,
  Download,
  Music,
  Gauge,
  Sparkles,
  Sliders,
  ChevronRight,
} from 'lucide-react';
import type { AudioInfo, NoteItem, TranscriptionResult } from '../types';
import { PianoRoll } from './PianoRoll';
import { SheetMusicView } from './SheetMusicView';
import { PitchTimeline } from './PitchTimeline';
import { PitchCorrectionControls } from './PitchCorrectionControls';

interface VisualizationHubProps {
  transcription: TranscriptionResult;
  audioInfo: AudioInfo;
  onTranscriptionUpdate: (updated: TranscriptionResult) => void;
  onNavigateToPractice: () => void;
}

export const VisualizationHub: React.FC<VisualizationHubProps> = ({
  transcription,
  audioInfo,
  onTranscriptionUpdate,
  onNavigateToPractice,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'piano-roll' | 'sheet-music' | 'pitch-timeline'>('piano-roll');
  const [originalCopy] = useState<TranscriptionResult>(transcription);
  const [currentTime, setCurrentTime] = useState(0);

  const duration = transcription.duration || audioInfo.duration || 10;

  const handleNotesChange = (newNotes: NoteItem[]) => {
    onTranscriptionUpdate({
      ...transcription,
      notes: newNotes,
    });
  };

  return (
    <div className="space-y-6">
      {/* Musical Metadata & Export Header Card */}
      <div className="daw-panel p-6 border border-slate-800 bg-slate-900/60 rounded-2xl shadow-xl flex flex-wrap items-center justify-between gap-6">
        <div className="flex flex-wrap items-center gap-6">
          {/* Key Detection Card */}
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-cyan-950/80 border border-cyan-800/60 text-cyan-400">
              <Music className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                Detected Key & Scale
              </span>
              <div className="text-base font-bold text-white flex items-center gap-2">
                {transcription.key_estimate}
                <span className="text-[10px] font-normal text-slate-400 font-mono">
                  (algorithmic estimate)
                </span>
              </div>
            </div>
          </div>

          <div className="h-8 w-px bg-slate-800 hidden sm:block"></div>

          {/* BPM Card */}
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-indigo-950/80 border border-indigo-800/60 text-indigo-400">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                Tempo (BPM)
              </span>
              <div className="text-base font-bold text-white font-mono">
                {transcription.bpm} <span className="text-xs font-normal text-slate-400">BPM</span>
              </div>
            </div>
          </div>

          <div className="h-8 w-px bg-slate-800 hidden sm:block"></div>

          {/* Engine & Confidence */}
          <div>
            <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
              Transcription Engine
            </span>
            <div className="text-xs text-slate-300 font-mono mt-0.5">
              {transcription.transcription_engine} • {(transcription.confidence_overall * 100).toFixed(0)}% conf
            </div>
          </div>
        </div>

        {/* Action Controls: Exports & Practice CTA */}
        <div className="flex flex-wrap items-center gap-3">
          {/* MIDI Export */}
          <a
            href={`/api/audio/${transcription.audio_id}/export/midi`}
            download={`${transcription.audio_id}.mid`}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700/60 text-xs font-semibold transition-all shadow-sm"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            Export MIDI (.mid)
          </a>

          {/* MusicXML Export */}
          <a
            href={`/api/audio/${transcription.audio_id}/export/musicxml`}
            download={`${transcription.audio_id}.musicxml`}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700/60 text-xs font-semibold transition-all shadow-sm"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            Export MusicXML
          </a>

          {/* Open Practice Mode CTA */}
          <button
            onClick={onNavigateToPractice}
            className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-bold rounded-xl text-xs shadow-lg shadow-amber-500/20 transition-all"
          >
            Practice This Track
            <ChevronRight className="w-4 h-4 ml-0.5" />
          </button>
        </div>
      </div>

      {/* FL Studio NewTone Pitch Correction / Simplification Bar */}
      <PitchCorrectionControls
        audioId={transcription.audio_id}
        originalTranscription={originalCopy}
        currentTranscription={transcription}
        onTranscriptionUpdate={onTranscriptionUpdate}
      />

      {/* View Sub-Tabs (Piano Roll / Sheet Music / Pitch Timeline) */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveSubTab('piano-roll')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeSubTab === 'piano-roll'
              ? 'bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <Piano className="w-4 h-4" />
          Piano Roll (Interactive DAW)
        </button>

        <button
          onClick={() => setActiveSubTab('pitch-timeline')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeSubTab === 'pitch-timeline'
              ? 'bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <Activity className="w-4 h-4" />
          Pitch Contour Timeline
        </button>

        <button
          onClick={() => setActiveSubTab('sheet-music')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeSubTab === 'sheet-music'
              ? 'bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <FileText className="w-4 h-4" />
          Sheet Music (Standard Score)
        </button>
      </div>

      {/* Main Active Visualizer View */}
      {activeSubTab === 'piano-roll' && (
        <PianoRoll
          notes={transcription.notes}
          currentTime={currentTime}
          duration={duration}
          onNotesChange={handleNotesChange}
        />
      )}

      {activeSubTab === 'pitch-timeline' && (
        <PitchTimeline
          originalContour={originalCopy.pitch_contour || []}
          simplifiedContour={transcription.pitch_contour || []}
          notes={transcription.notes}
          currentTime={currentTime}
          duration={duration}
          onSeek={(t) => setCurrentTime(t)}
        />
      )}

      {activeSubTab === 'sheet-music' && (
        <SheetMusicView
          transcription={transcription}
          currentTime={currentTime}
        />
      )}
    </div>
  );
};
