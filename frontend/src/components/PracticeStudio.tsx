import React, { useRef, useState, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Play,
  Square,
  Volume2,
  VolumeX,
  Target,
  Music,
  ChevronLeft,
  ChevronRight,
  Clock,
  Repeat,
  History,
  Timer,
} from 'lucide-react';
import type { NoteItem, TranscriptionResult, EvaluationResponse, PitchFrame, AudioInfo, PracticeConfigSettings } from '../types';
import { MicPitchTracker } from '../services/micPitchTracker';
import type { LivePitchData } from '../services/micPitchTracker';
import { getAudioFileUrl, evaluatePractice } from '../services/api';
import { synth } from '../services/synth';
import { recordPracticeSession } from '../services/historyService';
import { EvaluationModal } from './EvaluationModal';
import { SmartHistoryModal } from './SmartHistoryModal';

interface PracticeStudioProps {
  transcription: TranscriptionResult;
  audioId: string;
  audioInfo?: AudioInfo | null;
  onRestoreTrack?: (
    audio: AudioInfo,
    transcription: TranscriptionResult,
    settings: PracticeConfigSettings
  ) => void;
}

export const PracticeStudio: React.FC<PracticeStudioProps> = ({
  transcription,
  audioId,
  audioInfo,
  onRestoreTrack,
}) => {
  // Practice session states
  const [isPracticing, setIsPracticing] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [transposeSemitones, setTransposeSemitones] = useState<number>(0);
  const [livePitch, setLivePitch] = useState<LivePitchData | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Pre-Practice Countdown Timer (Enabled by default, 3s default, customizable)
  const [countdownEnabled, setCountdownEnabled] = useState<boolean>(true);
  const [countdownDuration, setCountdownDuration] = useState<number>(3);
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);

  // Practice Mode (Full Song vs Note-by-Note)
  const [practiceMode, setPracticeMode] = useState<'full' | 'note'>('full');
  const [selectedNoteIndex, setSelectedNoteIndex] = useState<number>(0);
  const [loopNote, setLoopNote] = useState<boolean>(true);

  // Digital timeline clock
  const [currentTimeDisplay, setCurrentTimeDisplay] = useState<number>(0);
  const lastDisplayUpdateRef = useRef<number>(0);

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

  // Customizable Speed Handler
  const handleSpeedChange = (speed: number) => {
    const clamped = Math.max(0.25, Math.min(2.0, Math.round(speed * 100) / 100));
    setPlaybackSpeed(clamped);
    if (audioRef.current) {
      audioRef.current.playbackRate = clamped;
      audioRef.current.preservesPitch = true;
    }
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
  const selectedNote: NoteItem | undefined = effectiveNotes[selectedNoteIndex];

  // Stop mic and countdown on unmount
  useEffect(() => {
    return () => {
      if (trackerRef.current) {
        trackerRef.current.stop();
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  // Cancel countdown if Escape key is pressed
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && countdownValue !== null) {
        cancelCountdown();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [countdownValue]);

  // Audio beep generator for studio countdown lead-in
  const playCountdownBeep = (isFinal: boolean) => {
    try {
      if (isFinal) {
        synth.playTone(1760, 0.22, 0.5); // High crisp beep for GO!
      } else {
        synth.playTone(880, 0.1, 0.35); // Lead-in beep for 3, 2, 1
      }
    } catch {
      // Audio context error ignore
    }
  };

  const cancelCountdown = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdownValue(null);
  };

  // Pre-Practice trigger with countdown logic
  const handleStartPracticeClick = () => {
    if (isPracticing) return;

    if (!countdownEnabled || countdownDuration <= 0) {
      executeStartPractice();
      return;
    }

    // Start countdown
    cancelCountdown();
    let currentCount = countdownDuration;
    setCountdownValue(currentCount);
    playCountdownBeep(false);

    countdownIntervalRef.current = window.setInterval(() => {
      currentCount -= 1;
      if (currentCount > 0) {
        setCountdownValue(currentCount);
        playCountdownBeep(false);
      } else {
        // Countdown reached 0
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
        setCountdownValue(0);
        playCountdownBeep(true);

        setTimeout(() => {
          setCountdownValue(null);
          executeStartPractice();
        }, 320);
      }
    }, 1000);
  };

  // Actual execution of practice session
  const executeStartPractice = async () => {
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
        if (practiceMode === 'note' && selectedNote) {
          // In Note-by-Note mode, cue slightly before note start
          audioRef.current.currentTime = Math.max(0, selectedNote.start - 0.15);
        } else {
          audioRef.current.currentTime = 0;
        }
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
    cancelCountdown();
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
        const evalTargetNotes = practiceMode === 'note' && selectedNote
          ? [selectedNote]
          : effectiveNotes;
        const resp = await evaluatePractice(evalTargetNotes, userPitchHistory.current, 50.0);
        setEvaluation(resp);

        // Record session into Smart Performance History
        const currentSettings: PracticeConfigSettings = {
          mode: practiceMode,
          target_note_name: practiceMode === 'note' && selectedNote ? selectedNote.note_name : undefined,
          target_midi: practiceMode === 'note' && selectedNote ? selectedNote.midi : undefined,
          playback_speed: playbackSpeed,
          transpose_semitones: transposeSemitones,
          tolerance_cents: 50.0,
        };

        recordPracticeSession(
          audioInfo || {
            id: audioId,
            filename: `${transcription.key_estimate || 'Melody'}_practice.wav`,
            duration: duration,
          },
          currentSettings,
          resp
        );
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

    // Dark sleek DAW background
    ctx.fillStyle = '#070b12';
    ctx.fillRect(0, 0, width, height);

    const currentTime = audioRef.current ? audioRef.current.currentTime : 0;

    // Handle note-by-note looping during active practice
    if (isPracticing && practiceMode === 'note' && selectedNote && loopNote && audioRef.current) {
      const loopEnd = selectedNote.end + 0.2;
      const loopStart = Math.max(0, selectedNote.start - 0.15);
      if (currentTime >= loopEnd) {
        audioRef.current.currentTime = loopStart;
      }
    }

    // Smoothly update digital clock display
    const nowPerf = performance.now();
    if (nowPerf - lastDisplayUpdateRef.current > 40) {
      lastDisplayUpdateRef.current = nowPerf;
      setCurrentTimeDisplay(currentTime);
    }

    // Pitch Range
    const allMidis = effectiveNotes.map((n) => n.midi);
    const minMidi = allMidis.length > 0 ? Math.max(36, Math.min(...allMidis) - 3) : 48;
    const maxMidi = allMidis.length > 0 ? Math.min(84, Math.max(...allMidis) + 3) : 72;
    const midiRange = maxMidi - minMidi || 12;

    const axisY = height - 20;

    // 1. Horizontal Pitch Guides
    for (let m = minMidi; m <= maxMidi; m++) {
      const y = height - ((m - minMidi) / midiRange) * (height - 45) - 34;
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

    // 2. Reference Target Notes
    effectiveNotes.forEach((n, idx) => {
      const x = 35 + (n.start / duration) * (width - 35);
      const w = Math.max(10, (n.duration / duration) * (width - 35));
      const y = height - ((n.midi - minMidi) / midiRange) * (height - 45) - 34;

      const isCurrent = currentTime >= n.start && currentTime <= n.end;
      const isSelectedInNoteMode = practiceMode === 'note' && idx === selectedNoteIndex;

      if (practiceMode === 'note') {
        if (isSelectedInNoteMode) {
          // Highlighted Selected Target Note
          ctx.fillStyle = 'rgba(245, 158, 11, 0.45)';
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2.5;
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 12;
        } else {
          // Dimmed non-target notes
          ctx.fillStyle = 'rgba(14, 165, 233, 0.08)';
          ctx.strokeStyle = 'rgba(14, 165, 233, 0.25)';
          ctx.lineWidth = 1;
          ctx.shadowBlur = 0;
        }
      } else {
        // Full Song Mode
        ctx.fillStyle = isCurrent ? 'rgba(56, 189, 248, 0.45)' : 'rgba(14, 165, 233, 0.2)';
        ctx.strokeStyle = isCurrent ? '#38bdf8' : 'rgba(14, 165, 233, 0.6)';
        ctx.lineWidth = isCurrent ? 2 : 1;
        ctx.shadowBlur = isCurrent ? 8 : 0;
        ctx.shadowColor = '#38bdf8';
      }

      ctx.beginPath();
      ctx.roundRect(x, y, w, 16, 4);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Note label
      ctx.fillStyle = isSelectedInNoteMode ? '#fef08a' : isCurrent ? '#ffffff' : '#bae6fd';
      ctx.font = isSelectedInNoteMode ? 'bold 10px monospace' : 'bold 9px sans-serif';
      ctx.fillText(n.note_name, x + 4, y + 11);

      // In note mode, draw a small target badge above the selected note
      if (isSelectedInNoteMode) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 9px monospace';
        ctx.fillText('▼ TARGET', Math.max(35, x), y - 4);
      }
    });

    // 3. User Singing Pitch Trajectory (Live Real-time Curve)
    const history = userPitchHistory.current;
    if (history.length > 1) {
      for (let i = 1; i < history.length; i++) {
        const p1 = history[i - 1];
        const p2 = history[i];

        if (p2.time - p1.time > 0.12) continue; // Gap

        const x1 = 35 + (p1.time / duration) * (width - 35);
        const y1 = height - ((p1.midi - minMidi) / midiRange) * (height - 45) - 26;
        const x2 = 35 + (p2.time / duration) * (width - 35);
        const y2 = height - ((p2.midi - minMidi) / midiRange) * (height - 45) - 26;

        // Check if pitch is near target note (within ±0.5 semitone = 50 cents)
        const refNote = practiceMode === 'note' && selectedNote
          ? selectedNote
          : effectiveNotes.find((n) => p2.time >= n.start && p2.time <= n.end);

        const isHit = refNote && Math.abs(p2.midi - refNote.midi) <= 0.5;

        ctx.strokeStyle = isHit ? '#10b981' : '#f59e0b'; // Emerald if hit, amber if drift
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

    // 4. Bottom Time Axis & Second Markings
    ctx.fillStyle = '#0a101d';
    ctx.fillRect(0, axisY, width, 20);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(35, axisY);
    ctx.lineTo(width, axisY);
    ctx.stroke();

    const timeStep = duration > 20 ? 4.0 : duration > 10 ? 2.0 : duration > 5 ? 1.0 : 0.5;
    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    for (let t = 0; t <= duration; t += timeStep) {
      const tx = 35 + (t / duration) * (width - 35);
      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(tx, axisY);
      ctx.lineTo(tx, axisY + 4);
      ctx.stroke();
      ctx.fillText(`${t.toFixed(1)}s`, Math.max(35, tx - 10), height - 6);
    }

    // 5. Playhead Line & Floating Current Second Badge
    const cursorX = 35 + (currentTime / duration) * (width - 35);
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, axisY);
    ctx.stroke();

    // Floating Current Second Badge attached to Playhead
    const timeText = `${currentTime.toFixed(2)}s`;
    ctx.font = 'bold 10px monospace';
    const textMetrics = ctx.measureText(timeText);
    const badgeW = textMetrics.width + 12;
    const badgeH = 18;
    const badgeX = Math.max(35, Math.min(width - badgeW - 4, cursorX - badgeW / 2));
    const badgeY = 6;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(timeText, badgeX + 6, badgeY + 13);
  };

  useEffect(() => {
    drawPracticeCanvas();
  }, [currentTimeFromAudio(audioRef.current), transposeSemitones, practiceMode, selectedNoteIndex]);

  // Click directly on canvas to select and audition a note
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || effectiveNotes.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const allMidis = effectiveNotes.map((n) => n.midi);
    const minMidi = allMidis.length > 0 ? Math.max(36, Math.min(...allMidis) - 3) : 48;
    const maxMidi = allMidis.length > 0 ? Math.min(84, Math.max(...allMidis) + 3) : 72;
    const midiRange = maxMidi - minMidi || 12;

    for (let i = 0; i < effectiveNotes.length; i++) {
      const n = effectiveNotes[i];
      const nx = 35 + (n.start / duration) * (width - 35);
      const nw = Math.max(10, (n.duration / duration) * (width - 35));
      const ny = height - ((n.midi - minMidi) / midiRange) * (height - 45) - 34;
      const nh = 16;

      if (clickX >= nx - 4 && clickX <= nx + nw + 4 && clickY >= ny - 4 && clickY <= ny + nh + 4) {
        setSelectedNoteIndex(i);
        if (practiceMode !== 'note') {
          setPracticeMode('note');
        }
        synth.playMidiNote(n.midi, 0.5);
        if (audioRef.current && !isPracticing) {
          audioRef.current.currentTime = Math.max(0, n.start - 0.1);
          setCurrentTimeDisplay(audioRef.current.currentTime);
        }
        break;
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Audio element for accompaniment / reference melody */}
      <audio
        ref={audioRef}
        src={getAudioFileUrl(audioId)}
        onEnded={stopPracticeSession}
        onTimeUpdate={(e) => setCurrentTimeDisplay(e.currentTarget.currentTime)}
        preload="auto"
        muted={isMuted}
      />

      {/* Practice Header & Controls Bar */}
      <div className="daw-panel p-6 border border-slate-800 bg-slate-900/60 rounded-2xl shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
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
                {practiceMode === 'note'
                  ? 'Note-by-Note Mode: Focus and master one target note at a time.'
                  : 'Full Song Mode: Sing along with the entire phrase while the studio measures your vocal pitch.'}
              </p>
            </div>
          </div>

          {/* Action Buttons: History + Timeline Clock + Mute Toggle + Start / Stop Practice */}
          <div className="flex items-center gap-2.5">
            {/* Smart Performance History Button */}
            <button
              onClick={() => setIsHistoryOpen(true)}
              className="p-2.5 rounded-xl border border-slate-800 bg-slate-950/90 text-slate-400 hover:text-cyan-300 hover:border-slate-700 shadow-sm transition-all flex items-center justify-center"
              title="Smart Performance History"
              aria-label="Smart Performance History"
            >
              <History className="w-4 h-4" />
            </button>

            {/* Live Digital Timeline Seconds Readout */}
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs shadow-inner">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-bold text-white tracking-wider">
                {currentTimeDisplay.toFixed(2)}s
              </span>
              <span className="text-slate-600">/</span>
              <span className="text-slate-400">
                {duration.toFixed(2)}s
              </span>
            </div>

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

            {/* Start / Finish Action Button */}
            {!isPracticing ? (
              countdownValue !== null ? (
                <button
                  onClick={cancelCountdown}
                  className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded-xl text-sm shadow-lg shadow-amber-600/25 transition-all animate-pulse"
                >
                  <Timer className="w-4 h-4" />
                  Starting in {countdownValue}s... (Cancel)
                </button>
              ) : (
                <button
                  onClick={handleStartPracticeClick}
                  className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold rounded-xl text-sm shadow-lg shadow-emerald-500/25 transition-all"
                >
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                  {practiceMode === 'note' ? 'Practice Note' : 'Start Practice Session'}
                </button>
              )
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

        {/* Practice Mode Switcher (Full Song vs Note-by-Note) */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800">
            <button
              onClick={() => {
                if (isPracticing) stopPracticeSession();
                cancelCountdown();
                setPracticeMode('full');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                practiceMode === 'full'
                  ? 'bg-cyan-950 border border-cyan-700/60 text-cyan-300 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Music className="w-3.5 h-3.5" />
              <span>Full Song Mode</span>
            </button>
            <button
              onClick={() => {
                if (isPracticing) stopPracticeSession();
                cancelCountdown();
                setPracticeMode('note');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                practiceMode === 'note'
                  ? 'bg-amber-950/50 border border-amber-500/60 text-amber-300 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Target className="w-3.5 h-3.5" />
              <span>Note-by-Note Mode</span>
            </button>
          </div>

          <div className="text-xs text-slate-500">
            {practiceMode === 'note'
              ? 'Click any note on the timeline or use buttons below to switch target'
              : 'Continuous playback across all extracted musical notes'}
          </div>
        </div>

        {/* Note-by-Note Dedicated Control Toolbar */}
        {practiceMode === 'note' && (
          <div className="p-3.5 rounded-xl bg-slate-950/90 border border-amber-500/30 flex flex-wrap items-center justify-between gap-3">
            {/* Note Stepping & Audition */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const nextIdx = Math.max(0, selectedNoteIndex - 1);
                    setSelectedNoteIndex(nextIdx);
                    const note = effectiveNotes[nextIdx];
                    if (note) {
                      synth.playMidiNote(note.midi, 0.4);
                      if (audioRef.current && !isPracticing) {
                        audioRef.current.currentTime = Math.max(0, note.start - 0.1);
                        setCurrentTimeDisplay(audioRef.current.currentTime);
                      }
                    }
                  }}
                  disabled={selectedNoteIndex <= 0}
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  title="Previous Note (←)"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    const nextIdx = Math.min(effectiveNotes.length - 1, selectedNoteIndex + 1);
                    setSelectedNoteIndex(nextIdx);
                    const note = effectiveNotes[nextIdx];
                    if (note) {
                      synth.playMidiNote(note.midi, 0.4);
                      if (audioRef.current && !isPracticing) {
                        audioRef.current.currentTime = Math.max(0, note.start - 0.1);
                        setCurrentTimeDisplay(audioRef.current.currentTime);
                      }
                    }
                  }}
                  disabled={selectedNoteIndex >= effectiveNotes.length - 1}
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  title="Next Note (→)"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Target Note Badge */}
              {selectedNote && (
                <div className="flex items-center gap-2 px-3 py-1 bg-amber-950/40 border border-amber-500/40 rounded-xl">
                  <Target className="w-4 h-4 text-amber-400" />
                  <span className="text-xs text-slate-400">Target Note {selectedNoteIndex + 1}/{effectiveNotes.length}:</span>
                  <strong className="text-sm font-mono font-bold text-amber-300">{selectedNote.note_name}</strong>
                  <span className="text-xs text-slate-400 font-mono">({selectedNote.frequency.toFixed(1)} Hz)</span>
                  <span className="text-xs text-slate-500 font-mono">[{selectedNote.start.toFixed(2)}s - {selectedNote.end.toFixed(2)}s]</span>
                </div>
              )}

              {/* Audition Note with Synth */}
              {selectedNote && (
                <button
                  onClick={() => synth.playMidiNote(selectedNote.midi, 0.6)}
                  className="flex items-center gap-1.5 px-3 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-lg text-xs font-semibold text-cyan-300 transition-all"
                  title="Hear target note pitch with reference synth"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Hear Pitch</span>
                </button>
              )}

              {/* Loop Note Toggle */}
              <button
                onClick={() => setLoopNote((prev) => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                  loopNote
                    ? 'bg-emerald-950/60 border-emerald-600/60 text-emerald-400'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title="Loop playback on this specific note"
              >
                <Repeat className="w-3.5 h-3.5" />
                <span>Loop Note</span>
              </button>
            </div>

            {/* Quick Note Selector Carousel */}
            <div className="flex items-center gap-1.5 overflow-x-auto max-w-full py-1">
              {effectiveNotes.map((note, idx) => (
                <button
                  key={note.id || idx}
                  onClick={() => {
                    setSelectedNoteIndex(idx);
                    synth.playMidiNote(note.midi, 0.4);
                    if (audioRef.current && !isPracticing) {
                      audioRef.current.currentTime = Math.max(0, note.start - 0.1);
                      setCurrentTimeDisplay(audioRef.current.currentTime);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all shrink-0 ${
                    idx === selectedNoteIndex
                      ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                      : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  }`}
                >
                  {idx + 1}. {note.note_name}
                </button>
              ))}
            </div>
          </div>
        )}

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

        {/* Practice Toolbar: Customizable Speed, Pre-Practice Countdown & Key Shift */}
        <div className="flex flex-wrap items-center justify-between gap-4 mt-4 pt-3 border-t border-slate-800/80">
          {/* Customizable Playback Speed */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold">Speed:</span>
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-2 py-1 rounded-xl">
              <button
                onClick={() => handleSpeedChange(playbackSpeed - 0.05)}
                disabled={playbackSpeed <= 0.25}
                className="w-5 h-5 flex items-center justify-center rounded bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-30 text-xs font-bold transition-colors"
                title="Decrease speed by 5%"
              >
                -
              </button>

              <input
                type="range"
                min="0.25"
                max="2.0"
                step="0.05"
                value={playbackSpeed}
                onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                className="w-20 md:w-24 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                title={`Playback Speed: ${Math.round(playbackSpeed * 100)}%`}
              />

              <button
                onClick={() => handleSpeedChange(playbackSpeed + 0.05)}
                disabled={playbackSpeed >= 2.0}
                className="w-5 h-5 flex items-center justify-center rounded bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-30 text-xs font-bold transition-colors"
                title="Increase speed by 5%"
              >
                +
              </button>

              <span className="text-xs font-mono font-bold text-cyan-400 min-w-10 text-center select-none">
                {Math.round(playbackSpeed * 100)}%
              </span>
            </div>

            {/* Quick Presets */}
            <div className="hidden sm:flex items-center gap-1 bg-slate-950/70 border border-slate-800/80 p-1 rounded-xl">
              {[0.5, 0.75, 1.0, 1.25].map((rate) => (
                <button
                  key={rate}
                  onClick={() => handleSpeedChange(rate)}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-all ${
                    playbackSpeed === rate
                      ? 'bg-cyan-950 border border-cyan-700/60 text-cyan-300'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {Math.round(rate * 100)}%
                </button>
              ))}
            </div>
          </div>

          {/* Pre-Practice Countdown Setting (Toggleable, default 3s, customizable) */}
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setCountdownEnabled((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                countdownEnabled
                  ? 'bg-cyan-950 border border-cyan-800/60 text-cyan-300'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
              title={countdownEnabled ? "Disable pre-practice countdown" : "Enable pre-practice countdown"}
            >
              <Timer className="w-3.5 h-3.5" />
              <span>Lead-in: {countdownEnabled ? `${countdownDuration}s` : 'Off'}</span>
            </button>

            {countdownEnabled && (
              <div className="flex items-center gap-1 px-1 border-l border-slate-800">
                <button
                  onClick={() => setCountdownDuration((d) => Math.max(1, d - 1))}
                  disabled={countdownDuration <= 1}
                  className="w-5 h-5 flex items-center justify-center rounded bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-30 text-xs font-bold transition-colors"
                  title="Decrease countdown (-1s)"
                >
                  -
                </button>
                <span className="text-xs font-mono font-bold text-cyan-400 min-w-6 text-center select-none">
                  {countdownDuration}s
                </span>
                <button
                  onClick={() => setCountdownDuration((d) => Math.min(10, d + 1))}
                  disabled={countdownDuration >= 10}
                  className="w-5 h-5 flex items-center justify-center rounded bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-30 text-xs font-bold transition-colors"
                  title="Increase countdown (+1s)"
                >
                  +
                </button>
              </div>
            )}
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
        </div>
      </div>

      {/* Dual Layer Real-time Pitch Canvas Container */}
      <div className="daw-panel p-4 border border-slate-800 bg-slate-900/50 rounded-2xl space-y-2 relative">
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
            onClick={handleCanvasClick}
            className="w-full h-80 block cursor-pointer"
            title="Click any note to select and practice it"
          />

          {/* Studio Countdown HUD Overlay */}
          {countdownValue !== null && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-md rounded-xl animate-fade-in select-none">
              <div className="flex flex-col items-center gap-3">
                <div className="text-8xl font-black font-mono tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-cyan-300 via-teal-300 to-emerald-400 drop-shadow-[0_0_35px_rgba(6,182,212,0.7)] animate-pulse">
                  {countdownValue > 0 ? countdownValue : 'SING!'}
                </div>
                <p className="text-sm font-semibold tracking-wider text-slate-300 uppercase">
                  {practiceMode === 'note' && selectedNote
                    ? `Get Ready for Note: ${selectedNote.note_name}`
                    : 'Get ready to sing with the track...'}
                </p>
                <button
                  onClick={cancelCountdown}
                  className="mt-3 px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs font-semibold text-slate-400 hover:text-white transition-all shadow-md"
                >
                  Cancel Countdown (Esc)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Evaluation Results Modal */}
      {evaluation && (
        <EvaluationModal
          evaluation={evaluation}
          onClose={() => setEvaluation(null)}
          onRetry={() => {
            setEvaluation(null);
            handleStartPracticeClick();
          }}
        />
      )}

      {/* Smart Performance History Modal */}
      {isHistoryOpen && (
        <SmartHistoryModal
          currentAudioId={audioId}
          onClose={() => setIsHistoryOpen(false)}
          onApplySettingsOnly={(settings) => {
            setPlaybackSpeed(settings.playback_speed);
            if (audioRef.current) {
              audioRef.current.playbackRate = settings.playback_speed;
              audioRef.current.preservesPitch = true;
            }
            setTransposeSemitones(settings.transpose_semitones);
            setPracticeMode(settings.mode);
            if (settings.mode === 'note' && settings.target_note_name) {
              const matchIdx = effectiveNotes.findIndex(
                (n) => n.note_name === settings.target_note_name
              );
              if (matchIdx >= 0) setSelectedNoteIndex(matchIdx);
            }
          }}
          onRestore={(newAudio, newTranscription, settings) => {
            if (onRestoreTrack) {
              onRestoreTrack(newAudio, newTranscription, settings);
            } else {
              setPlaybackSpeed(settings.playback_speed);
              setTransposeSemitones(settings.transpose_semitones);
              setPracticeMode(settings.mode);
            }
          }}
        />
      )}
    </div>
  );
};

function currentTimeFromAudio(audio: HTMLAudioElement | null): number {
  return audio ? audio.currentTime : 0;
}
