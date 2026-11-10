import React, { useRef, useState, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Play,
  Pause,
  Square,
  Award,
  Volume2,
  VolumeX,
  RefreshCw,
  Gauge,
  Sliders,
  Sparkles,
} from 'lucide-react';
import type { NoteItem, TranscriptionResult, EvaluationResponse, PitchFrame } from '../types';
import { MicPitchTracker } from '../services/micPitchTracker';
import type { LivePitchData } from '../services/micPitchTracker';
import { getAudioFileUrl, evaluatePractice } from '../services/api';
import { EvaluationModal } from './EvaluationModal';

interface PracticeStudioProps {
  transcription: TranscriptionResult;
  audioId: string;
}

export const PracticeStudio: React.FC<PracticeStudioProps> = ({
  transcription,
  audioId,
}) => {
  const [isPracticing, setIsPracticing] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [transposeSemitones, setTransposeSemitones] = useState<number>(0);
  const [livePitch, setLivePitch] = useState<LivePitchData | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackerRef = useRef<MicPitchTracker | null>(null);
  const userPitchHistory = useRef<PitchFrame[]>([]);
  const animRef = useRef<number | null>(null);

  // Sync mute state with reference audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const toggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  // Transpose notes for practice if user changes key
  const effectiveNotes: NoteItem[] = transcription.notes.map((n) => {
    const newMidi = n.midi + transposeSemitones;
    const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const octave = Math.floor(newMidi / 12) - 1;
    const name = `${NOTE_NAMES[((newMidi % 12) + 12) % 12]}${octave}`;
    return { ...n, midi: newMidi, note_name: name };
  });

  const duration = transcription.duration || 10;

  // Stop mic on unmount
  useEffect(() => {
    return () => {
      if (trackerRef.current) {
        trackerRef.current.stop();
      }
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  const startPracticeSession = async () => {
    try {
      userPitchHistory.current = [];
      const tracker = new MicPitchTracker();
      trackerRef.current = tracker;

      await tracker.start((data) => {
        setLivePitch(data);
        if (data.isVoiced && audioRef.current) {
          userPitchHistory.current.push({
            time: Math.round(audioRef.current.currentTime * 1000) / 1000,
            frequency: data.frequency,
            midi: data.midi,
            confidence: data.confidence,
          });
        }
      });

      setMicActive(true);
      setIsPracticing(true);

      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.playbackRate = playbackSpeed;
        audioRef.current.preservesPitch = true;
        audioRef.current.muted = isMuted;
        await audioRef.current.play();
      }

      startCanvasRenderLoop();
    } catch (err: any) {
      alert(`Microphone error: ${err.message || 'Please enable microphone access in your browser.'}`);
      setMicActive(false);
      setIsPracticing(false);
    }
  };

  const stopPracticeSession = async () => {
    if (trackerRef.current) {
      trackerRef.current.stop();
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setMicActive(false);
    setIsPracticing(false);

    // Call Evaluation API
    if (userPitchHistory.current.length > 0) {
      setIsEvaluating(true);
      try {
        const resp = await evaluatePractice(effectiveNotes, userPitchHistory.current, 50.0);
        setEvaluation(resp);
      } catch (err: any) {
        console.error('Evaluation error:', err);
      } finally {
        setIsEvaluating(false);
      }
    }
  };

  // Canvas Real-time Render Loop
  const startCanvasRenderLoop = () => {
    const render = () => {
      drawPracticeCanvas();
      if (isPracticing) {
        animRef.current = requestAnimationFrame(render);
      }
    };
    animRef.current = requestAnimationFrame(render);
  };

  const drawPracticeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    // Dark sleek background
    ctx.fillStyle = '#070b12';
    ctx.fillRect(0, 0, width, height);

    const currentTime = audioRef.current ? audioRef.current.currentTime : 0;

    // Pitch Range
    const allMidis = effectiveNotes.map((n) => n.midi);
    const minMidi = allMidis.length > 0 ? Math.max(36, Math.min(...allMidis) - 3) : 48;
    const maxMidi = allMidis.length > 0 ? Math.min(84, Math.max(...allMidis) + 3) : 72;
    const midiRange = maxMidi - minMidi || 12;

    // 1. Horizontal Pitch Guides
    for (let m = minMidi; m <= maxMidi; m++) {
      const y = height - ((m - minMidi) / midiRange) * (height - 30) - 15;
      ctx.strokeStyle = m % 12 === 0 ? '#334155' : '#111827';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(35, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const octave = Math.floor(m / 12) - 1;
      ctx.fillStyle = m % 12 === 0 ? '#94a3b8' : '#475569';
      ctx.font = '9px monospace';
      ctx.fillText(`${NOTE_NAMES[m % 12]}${octave}`, 6, y + 3);
    }

    // 2. Reference Target Notes (Glowing Cyan bars)
    effectiveNotes.forEach((n) => {
      const x = 35 + (n.start / duration) * (width - 35);
      const w = (n.duration / duration) * (width - 35);
      const y = height - ((n.midi - minMidi) / midiRange) * (height - 30) - 22;

      const isCurrent = currentTime >= n.start && currentTime <= n.end;

      ctx.fillStyle = isCurrent ? 'rgba(56, 189, 248, 0.4)' : 'rgba(14, 165, 233, 0.2)';
      ctx.strokeStyle = isCurrent ? '#38bdf8' : 'rgba(14, 165, 233, 0.6)';
      ctx.lineWidth = isCurrent ? 2 : 1;
      ctx.beginPath();
      ctx.roundRect(x, y, Math.max(6, w), 14, 3);
      ctx.fill();
      ctx.stroke();

      // Note label
      ctx.fillStyle = isCurrent ? '#ffffff' : '#bae6fd';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(n.note_name, x + 4, y + 10);
    });

    // 3. User Singing Pitch Trajectory (Live Real-time Curve)
    const history = userPitchHistory.current;
    if (history.length > 1) {
      for (let i = 1; i < history.length; i++) {
        const p1 = history[i - 1];
        const p2 = history[i];

        if (p2.time - p1.time > 0.12) continue; // Gap

        const x1 = 35 + (p1.time / duration) * (width - 35);
        const y1 = height - ((p1.midi - minMidi) / midiRange) * (height - 30) - 15;
        const x2 = 35 + (p2.time / duration) * (width - 35);
        const y2 = height - ((p2.midi - minMidi) / midiRange) * (height - 30) - 15;

        // Check if pitch is near any active reference note (within ±0.5 semitone = 50 cents)
        const refNote = effectiveNotes.find((n) => p2.time >= n.start && p2.time <= n.end);
        const isHit = refNote && Math.abs(p2.midi - refNote.midi) <= 0.5;

        ctx.strokeStyle = isHit ? '#10b981' : '#f59e0b'; // Emerald if hit, amber/yellow if drifting
        ctx.lineWidth = isHit ? 3.5 : 2.5;
        ctx.shadowColor = isHit ? '#10b981' : '#f59e0b';
        ctx.shadowBlur = 6;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    // 4. Playhead Line
    const cursorX = 35 + (currentTime / duration) * (width - 35);
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, height);
    ctx.stroke();
  };

  useEffect(() => {
    drawPracticeCanvas();
  }, [currentTimeFromAudio(audioRef.current), transposeSemitones]);

  return (
    <div className="space-y-6">
      {/* Audio element for accompaniment / reference melody */}
      <audio
        ref={audioRef}
        src={getAudioFileUrl(audioId)}
        onEnded={stopPracticeSession}
        preload="auto"
        muted={isMuted}
      />

      {/* Practice Header & Controls Bar */}
      <div className="daw-panel p-6 border border-slate-800 bg-slate-900/60 rounded-2xl shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-2xl border transition-all ${
              micActive
                ? 'bg-emerald-950 border-emerald-600/70 text-emerald-400 shadow-lg shadow-emerald-500/20'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}>
              {micActive ? <Mic className="w-5 h-5 animate-pulse" /> : <MicOff className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                Real-Time Vocal Practice Studio
                {isPracticing && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-700/60 text-emerald-400 font-mono animate-pulse">
                    LIVE TRACKING
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                Sing along with the original track while the studio measures your vocal pitch in real time.
              </p>
            </div>
          </div>

          {/* Action Buttons: Mute Toggle + Start / Stop Practice */}
          <div className="flex items-center gap-2.5">
            {/* Track Mute / Unmute Icon */}
            <button
              onClick={toggleMute}
              className={`p-2.5 rounded-xl border transition-all flex items-center justify-center ${
                isMuted
                  ? 'bg-rose-950/70 border-rose-700/70 text-rose-400 hover:bg-rose-900/80 shadow-md shadow-rose-950/50'
                  : 'bg-slate-950/90 border-slate-800 text-slate-300 hover:text-cyan-300 hover:border-slate-700 shadow-sm'
              }`}
              title={isMuted ? "Unmute Reference Track" : "Mute Reference Track (Sing A Cappella)"}
              aria-label={isMuted ? "Unmute Reference Track" : "Mute Reference Track"}
            >
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>

            {!isPracticing ? (
              <button
                onClick={startPracticeSession}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold rounded-xl text-sm shadow-lg shadow-emerald-500/25 transition-all"
              >
                <Play className="w-4 h-4 fill-current ml-0.5" />
                Start Practice Session
              </button>
            ) : (
              <button
                onClick={stopPracticeSession}
                className="flex items-center gap-2 px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-sm shadow-lg shadow-rose-600/25 transition-all"
              >
                <Square className="w-4 h-4 fill-current" />
                Finish & Evaluate
              </button>
            )}
          </div>
        </div>

        {/* Live Pitch Gauge / Meter */}
        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
          {/* Note Display */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Sung Pitch:</span>
            <div className="px-3 py-1 bg-slate-900 border border-slate-700 rounded-lg font-mono text-lg font-bold text-cyan-400">
              {livePitch?.isVoiced ? livePitch.noteName : '--'}
            </div>
          </div>

          {/* Frequency (Hz) */}
          <div className="text-xs text-slate-300 font-mono">
            <span className="text-slate-500">Frequency: </span>
            <strong>{livePitch?.isVoiced ? `${livePitch.frequency} Hz` : '--'}</strong>
          </div>

          {/* Cents Flat / Sharp Meter */}
          <div className="md:col-span-2 space-y-1">
            <div className="flex justify-between text-xs font-mono">
              <span className={livePitch && livePitch.centsDeviation < -15 ? 'text-amber-400' : 'text-slate-500'}>
                Flat (-50¢)
              </span>
              <span className={livePitch && Math.abs(livePitch.centsDeviation) <= 15 ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                In Tune ({livePitch?.isVoiced ? (livePitch.centsDeviation > 0 ? `+${livePitch.centsDeviation}` : livePitch.centsDeviation) : 0}¢)
              </span>
              <span className={livePitch && livePitch.centsDeviation > 15 ? 'text-amber-400' : 'text-slate-500'}>
                Sharp (+50¢)
              </span>
            </div>
            {/* Visual Balance Bar */}
            <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden relative">
              <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-slate-400 z-10"></div>
              {livePitch?.isVoiced && (
                <div
                  className={`h-full transition-all duration-75 ${
                    Math.abs(livePitch.centsDeviation) <= 15 ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                  style={{
                    width: `${Math.min(50, Math.abs(livePitch.centsDeviation))}%`,
                    marginLeft: livePitch.centsDeviation >= 0 ? '50%' : `${50 - Math.min(50, Math.abs(livePitch.centsDeviation))}%`,
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Practice Speed & Transpose Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mt-4 pt-3 border-t border-slate-800/80">
          {/* Slow Playback */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold">Speed:</span>
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-xl">
              {[0.5, 0.75, 1.0].map((rate) => (
                <button
                  key={rate}
                  onClick={() => {
                    setPlaybackSpeed(rate);
                    if (audioRef.current) {
                      audioRef.current.playbackRate = rate;
                      audioRef.current.preservesPitch = true;
                    }
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                    playbackSpeed === rate
                      ? 'bg-cyan-950 border border-cyan-700/60 text-cyan-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {rate * 100}%
                </button>
              ))}
            </div>
          </div>

          {/* Transposition */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold">Key Shift:</span>
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1 rounded-xl">
              <button
                onClick={() => setTransposeSemitones((t) => t - 1)}
                className="text-sm font-bold text-slate-400 hover:text-white px-1"
                title="Shift -1 semitone"
              >
                -
              </button>
              <span className="text-xs font-mono font-bold text-cyan-400 min-w-10 text-center">
                {transposeSemitones > 0 ? `+${transposeSemitones}` : transposeSemitones} st
              </span>
              <button
                onClick={() => setTransposeSemitones((t) => t + 1)}
                className="text-sm font-bold text-slate-400 hover:text-white px-1"
                title="Shift +1 semitone"
              >
                +
              </button>
            </div>
          </div>

          <div className="text-xs text-slate-500">
            Green line = In Pitch • Amber line = Drift/Variance
          </div>
        </div>
      </div>

      {/* Dual Layer Real-time Pitch Canvas */}
      <div className="daw-panel p-4 border border-slate-800 bg-slate-900/50 rounded-2xl space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <span className="flex items-center gap-1.5 text-cyan-300">
            <span className="w-3 h-2 bg-cyan-500/30 border border-cyan-400 rounded-xs"></span>
            Target Melody Notes
          </span>
          <span className="flex items-center gap-1.5 text-emerald-300">
            <span className="w-2.5 h-1 bg-emerald-400 rounded-full"></span>
            Your Live Singing Trace
          </span>
        </div>

        <div className="relative rounded-xl overflow-hidden border border-slate-800/90 bg-[#070b12]">
          <canvas
            ref={canvasRef}
            className="w-full h-80 block"
          />
        </div>
      </div>

      {/* Evaluation Results Modal */}
      {evaluation && (
        <EvaluationModal
          evaluation={evaluation}
          onClose={() => setEvaluation(null)}
          onRetry={() => {
            setEvaluation(null);
            startPracticeSession();
          }}
        />
      )}
    </div>
  );
};

function currentTimeFromAudio(audio: HTMLAudioElement | null): number {
  return audio ? audio.currentTime : 0;
}
