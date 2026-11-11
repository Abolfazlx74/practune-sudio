import React, { useState, useRef, useEffect } from 'react';
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
  Play,
  Pause,
  Square,
  Repeat,
  Volume2,
  VolumeX,
  Clock,
} from 'lucide-react';
import type { AudioInfo, NoteItem, TranscriptionResult } from '../types';
import { getAudioFileUrl } from '../services/api';
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

  // Playback & Transport State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animRef = useRef<number | null>(null);

  const duration = transcription.duration || audioInfo.duration || 10;

  // Sync mute state
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  // Keyboard shortcut: Spacebar to toggle Play/Pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying]);

  // Smooth 60 FPS playhead synchronization
  useEffect(() => {
    if (!isPlaying) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    const updatePlayhead = () => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
      }
      animRef.current = requestAnimationFrame(updatePlayhead);
    };

    animRef.current = requestAnimationFrame(updatePlayhead);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [isPlaying]);

  const togglePlay = async () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      try {
        audioRef.current.playbackRate = playbackSpeed;
        audioRef.current.preservesPitch = true;
        audioRef.current.muted = isMuted;
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (err) {
        console.error('Playback error:', err);
      }
    }
  };

  const handleStop = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const handleSeek = (time: number) => {
    const clamped = Math.max(0, Math.min(duration, time));
    setCurrentTime(clamped);
    if (audioRef.current) {
      audioRef.current.currentTime = clamped;
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
      audioRef.current.preservesPitch = true;
    }
  };

  const handleNotesChange = (newNotes: NoteItem[]) => {
    onTranscriptionUpdate({
      ...transcription,
      notes: newNotes,
    });
  };

  return (
    <div className="space-y-6">
      {/* Hidden audio element for synchronized playback */}
      <audio
        ref={audioRef}
        src={getAudioFileUrl(audioInfo.id)}
        onEnded={() => {
          if (isLooping && audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play();
          } else {
            setIsPlaying(false);
            setCurrentTime(0);
          }
        }}
        onPause={() => setIsPlaying(false)}
        preload="auto"
      />

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

      {/* Master Playback Transport Bar */}
      <div className="daw-panel p-4 border border-slate-800 bg-slate-900/70 rounded-2xl shadow-lg flex flex-wrap items-center justify-between gap-4">
        {/* Left: Transport buttons */}
        <div className="flex items-center gap-2.5">
          {/* Play / Pause Primary Button */}
          <button
            onClick={togglePlay}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs transition-all shadow-md ${
              isPlaying
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20'
                : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-cyan-500/25'
            }`}
            title={isPlaying ? "Pause Playback (Space)" : "Play Track & Synchronized Visualizers (Space)"}
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4 fill-current" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current ml-0.5" />
                <span>Play Visualizer</span>
              </>
            )}
          </button>

          {/* Stop / Rewind Button */}
          <button
            onClick={handleStop}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700/60 transition-colors"
            title="Stop & Rewind to Start"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>

          {/* Loop Button */}
          <button
            onClick={() => setIsLooping(!isLooping)}
            className={`p-2.5 rounded-xl border transition-all ${
              isLooping
                ? 'bg-cyan-950/80 border-cyan-600 text-cyan-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title={isLooping ? "Continuous Loop Enabled" : "Enable Continuous Loop"}
          >
            <Repeat className="w-4 h-4" />
          </button>

          {/* Digital Timeline Readout */}
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs shadow-inner">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-bold text-white tracking-wider">{currentTime.toFixed(2)}s</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-400">{duration.toFixed(2)}s</span>
          </div>
        </div>

        {/* Center: Timeline Progress Scrubber */}
        <div className="flex-1 min-w-[200px] max-w-md mx-2 flex items-center gap-2">
          <input
            type="range"
            min="0"
            max={duration}
            step="0.01"
            value={currentTime}
            onChange={(e) => handleSeek(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            title="Seek Playback Position"
          />
        </div>

        {/* Right: Audio Volume / Mute & Speed */}
        <div className="flex items-center gap-2.5">
          {/* Speed Presets */}
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-xl">
            {[0.5, 0.75, 1.0].map((rate) => (
              <button
                key={rate}
                onClick={() => handleSpeedChange(rate)}
                className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-all ${
                  playbackSpeed === rate
                    ? 'bg-cyan-950 border border-cyan-800 text-cyan-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {rate * 100}%
              </button>
            ))}
          </div>

          {/* Track Mute / Audio Toggle */}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`p-2.5 rounded-xl border transition-all ${
              isMuted
                ? 'bg-rose-950/70 border-rose-800 text-rose-400'
                : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-cyan-300'
            }`}
            title={isMuted ? "Unmute Audio Track" : "Mute Audio Track"}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

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
          onSeek={handleSeek}
        />
      )}

      {activeSubTab === 'pitch-timeline' && (
        <PitchTimeline
          originalContour={originalCopy.pitch_contour || []}
          simplifiedContour={transcription.pitch_contour || []}
          notes={transcription.notes}
          currentTime={currentTime}
          duration={duration}
          onSeek={handleSeek}
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
