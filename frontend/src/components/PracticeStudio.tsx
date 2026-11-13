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
  Eye,
  EyeOff,
  Mic2,
  Piano,
  Upload,
} from 'lucide-react';
import type { NoteItem, TranscriptionResult, EvaluationResponse, PitchFrame, AudioInfo, PracticeConfigSettings, Project } from '../types';
import { MicPitchTracker } from '../services/micPitchTracker';
import type { LivePitchData } from '../services/micPitchTracker';
import { getAudioFileUrl, evaluatePractice, evaluateRecordedPerformance } from '../services/api';
import { synth } from '../services/synth';
import { recordPracticeSession } from '../services/historyService';
import { recordPerformanceToProject } from '../services/projectService';
import { EvaluationModal } from './EvaluationModal';
import { SmartHistoryModal } from './SmartHistoryModal';

interface PracticeStudioProps {
  transcription: TranscriptionResult;
  audioId: string;
  audioInfo?: AudioInfo | null;
  currentProjectId?: string | null;
  onRestoreTrack?: (
    audio: AudioInfo,
    transcription: TranscriptionResult,
    settings: PracticeConfigSettings
  ) => void;
  onOpenProject?: (project: Project) => void;
  onPracticeModified?: () => void;
}

export const PracticeStudio: React.FC<PracticeStudioProps> = ({
  transcription,
  audioId,
  audioInfo,
  currentProjectId,
  onRestoreTrack,
  onOpenProject,
  onPracticeModified,
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
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Studio Domain Mode (Vocal vs Instrument) & Blind Memory Mode
  const [studioType, setStudioType] = useState<'vocal' | 'instrument'>('vocal');
  const [blindMode, setBlindMode] = useState<boolean>(false);
  const [showPostBlindAnalysis, setShowPostBlindAnalysis] = useState<boolean>(false);

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
  const livePitchRef = useRef<LivePitchData | null>(null);
  const recentMicMidisRef = useRef<number[]>([]);
  const smoothedMidiRef = useRef<number | null>(null);
  const animRef = useRef<number | null>(null);
  const isStoppingRef = useRef<boolean>(false);

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
  const transposedNotes: NoteItem[] = React.useMemo(() => {
    return transcription.notes.map((n) => {
      const newMidi = n.midi + transposeSemitones;
      const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      // FL Studio standard: MIDI 60 is C5, MIDI 69 is A5 (440Hz), MIDI 70 is A#5
      const octave = Math.floor(newMidi / 12);
      const name = `${NOTE_NAMES[((newMidi % 12) + 12) % 12]}${octave}`;
      const newFreq = 440 * Math.pow(2, (newMidi - 69) / 12);
      return { ...n, midi: newMidi, note_name: name, frequency: Math.round(newFreq * 10) / 10 };
    });
  }, [transcription.notes, transposeSemitones]);

  // In Instrument Mode: isolate clean main notes, filtering out transition micro-glitches (< 90ms)
  const effectiveNotes: NoteItem[] = React.useMemo(() => {
    if (studioType !== 'instrument') {
      return transposedNotes;
    }
    const clean: NoteItem[] = [];
    for (let i = 0; i < transposedNotes.length; i++) {
      const n = transposedNotes[i];
      const dur = n.end - n.start;
      if (dur < 0.09 && transposedNotes.length > 1) {
        const prev = i > 0 ? transposedNotes[i - 1] : null;
        const next = i < transposedNotes.length - 1 ? transposedNotes[i + 1] : null;
        if (prev && next && Math.abs(prev.midi - next.midi) >= 1) {
          continue; // inter-note slide / glitch
        }
        if (dur < 0.07) continue;
      }
      clean.push(n);
    }
    const candidates = clean.length > 0 ? clean : transposedNotes;
    // Merge consecutive split notes of same pitch with tiny rest (< 100ms)
    const merged: NoteItem[] = [];
    for (const n of candidates) {
      if (merged.length === 0) {
        merged.push({ ...n });
        continue;
      }
      const last = merged[merged.length - 1];
      if (last.midi === n.midi && (n.start - last.end) < 0.10) {
        last.end = n.end;
        last.duration = Math.round((last.end - last.start) * 1000) / 1000;
      } else {
        merged.push({ ...n });
      }
    }
    return merged;
  }, [transposedNotes, studioType]);

  // De-spiked & Smoothed Continuous F0 Contour (9-point Median Filter + Gaussian Smooth)
  const rawContour: PitchFrame[] = React.useMemo(() => {
    const source: PitchFrame[] =
      (transcription as any).pitch_contour || (transcription as any).f0_contour || [];
    if (source.length === 0) return [];

    // Step 1: 9-point Median Filter to strip harmonic spikes & background noise glitches
    const despiked: PitchFrame[] = source.map((curr, idx) => {
      if (curr.midi <= 0 || (curr.confidence !== undefined && curr.confidence < 0.25)) {
        return { ...curr, midi: 0 };
      }
      const windowVals: number[] = [];
      for (let k = Math.max(0, idx - 4); k <= Math.min(source.length - 1, idx + 4); k++) {
        const neighbor = source[k];
        if (
          neighbor.midi > 0 &&
          (neighbor.confidence === undefined || neighbor.confidence >= 0.25) &&
          Math.abs(neighbor.time - curr.time) <= 0.22
        ) {
          windowVals.push(neighbor.midi);
        }
      }
      if (windowVals.length < 3) {
        return { ...curr, midi: 0 };
      }
      windowVals.sort((a, b) => a - b);
      const medianMidi = windowVals[Math.floor(windowVals.length / 2)];
      return { ...curr, midi: medianMidi };
    });

    // Step 2: Weighted Gaussian smoothing over voiced segments
    const smoothed: PitchFrame[] = [];
    const weights = [0.08, 0.14, 0.22, 0.28, 0.22, 0.14, 0.08];
    for (let i = 0; i < despiked.length; i++) {
      const curr = despiked[i];
      if (curr.midi <= 0) {
        smoothed.push({ ...curr, midi: 0 });
        continue;
      }
      let wSum = 0;
      let valSum = 0;
      for (let offset = -3; offset <= 3; offset++) {
        const j = i + offset;
        if (j >= 0 && j < despiked.length && despiked[j].midi > 0) {
          const dt = Math.abs(despiked[j].time - curr.time);
          const dm = Math.abs(despiked[j].midi - curr.midi);
          if (dt <= 0.16 && dm <= 4.5) {
            const w = weights[offset + 3];
            valSum += despiked[j].midi * w;
            wSum += w;
          }
        }
      }
      smoothed.push({
        ...curr,
        midi: (wSum > 0 ? valSum / wSum : curr.midi) + transposeSemitones,
      });
    }
    return smoothed;
  }, [transcription, transposeSemitones]);

  // Helper to get reference MIDI at any timestamp
  const getTargetMidiAtTime = (t: number): number | null => {
    // 1. Direct matching with musical note plateaus (prevents transition glitches from skewing target)
    const refNote = practiceMode === 'note' && selectedNote
      ? selectedNote
      : effectiveNotes.find((n) => t >= n.start - 0.03 && t <= n.end + 0.03);
    if (refNote) {
      return refNote.midi;
    }

    // 2. Continuous contour interpolation during valid inter-note slides
    if (studioType === 'vocal' && rawContour.length > 0) {
      let lo = 0;
      let hi = rawContour.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rawContour[mid].time < t) lo = mid + 1;
        else hi = mid;
      }
      const p2 = rawContour[lo];
      const p1 = lo > 0 ? rawContour[lo - 1] : p2;

      if (p1 && p2 && p1.midi > 0 && p2.midi > 0 && p2.time - p1.time <= 0.15 && p2.time > p1.time) {
        if (Math.abs(p2.midi - p1.midi) <= 6.0) {
          const ratio = Math.max(0, Math.min(1, (t - p1.time) / (p2.time - p1.time)));
          return p1.midi + (p2.midi - p1.midi) * ratio;
        }
      }
      if (p2 && p2.midi > 0 && Math.abs(p2.time - t) <= 0.10) {
        return p2.midi;
      }
    }
    return null;
  };

  // Check if a sung MIDI matches the reference contour within a ±0.20s window
  const isUserPitchMatchedWithWindow = (t: number, userMidi: number): boolean => {
    if (studioType === 'vocal' && rawContour.length > 0) {
      let hasVoicedRefNearby = false;
      for (let i = 0; i < rawContour.length; i++) {
        const pt = rawContour[i];
        if (pt.time < t - 0.20) continue;
        if (pt.time > t + 0.20) break;
        if (pt.midi > 0) {
          hasVoicedRefNearby = true;
          if (Math.abs(userMidi - pt.midi) <= 0.85) {
            return true;
          }
        }
      }
      if (!hasVoicedRefNearby) return true;
      return false;
    }
    const targetMidi = getTargetMidiAtTime(t);
    if (targetMidi === null) return false;
    const diff = Math.abs(userMidi - targetMidi);
    return diff <= 0.85 || Math.round(userMidi) === Math.round(targetMidi);
  };

  // Fast median despiker with octave lock (zero phase-delay lag on note transitions)
  const stabilizeUserMidi = (rawMidi: number, timestamp: number): number => {
    let corrected = rawMidi;
    const refMidi = getTargetMidiAtTime(timestamp);

    if (refMidi !== null) {
      if (Math.abs((corrected - 12) - refMidi) <= 1.6) corrected -= 12;
      else if (Math.abs((corrected + 12) - refMidi) <= 1.6) corrected += 12;
    }

    const buf = recentMicMidisRef.current;
    buf.push(corrected);
    if (buf.length > 3) buf.shift();
    const sorted = [...buf].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

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
        synth.playTone(1760, 0.22, 0.5);
      } else {
        synth.playTone(880, 0.1, 0.35);
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
      isStoppingRef.current = false;
      userPitchHistory.current = [];
      livePitchRef.current = null;
      recentMicMidisRef.current = [];
      smoothedMidiRef.current = null;
      setShowPostBlindAnalysis(false);
      const tracker = new MicPitchTracker();
      trackerRef.current = tracker;

      await tracker.start((data) => {
        if (data.isVoiced && audioRef.current) {
          const rawTime = audioRef.current.currentTime;
          const exactTime = Math.max(0, Math.round(rawTime * 1000) / 1000);
          const cleanMidi = stabilizeUserMidi(data.midi, exactTime);
          const stabilizedData: LivePitchData = { ...data, midi: cleanMidi };
          livePitchRef.current = stabilizedData;
          setLivePitch(stabilizedData);

          userPitchHistory.current.push({
            time: exactTime,
            frequency: 440 * Math.pow(2, (cleanMidi - 69) / 12),
            midi: cleanMidi,
            confidence: data.confidence,
          });
        } else {
          recentMicMidisRef.current = [];
          smoothedMidiRef.current = null;
          livePitchRef.current = data;
          setLivePitch(data);
        }
      });

      setMicActive(true);
      setIsPracticing(true);

      if (audioRef.current) {
        if (practiceMode === 'note' && selectedNote) {
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

  // Build continuous contour phrase segments cloning NoteItem schema types (integer id & midi)
  const buildVocalReferenceSegments = (): NoteItem[] => {
    if (rawContour.length === 0 || effectiveNotes.length === 0) return effectiveNotes;
    const template = effectiveNotes[0];
    const segments: NoteItem[] = [];
    let segStart = -1;
    let segMidis: number[] = [];

    for (let i = 0; i < rawContour.length; i++) {
      const pt = rawContour[i];
      const prev = i > 0 ? rawContour[i - 1] : null;
      const isBreak = pt.midi <= 0 || (prev && prev.midi > 0 && pt.time - prev.time > 0.2);

      if (isBreak) {
        if (segStart >= 0 && segMidis.length >= 3) {
          const endT = prev ? prev.time : segStart + 0.1;
          const sorted = [...segMidis].sort((a, b) => a - b);
          const medMidi = sorted[Math.floor(sorted.length / 2)];
          const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
          const rMidi = Math.round(medMidi);
          const octave = Math.floor(rMidi / 12);
          const segId = typeof template.id === 'number' ? segments.length + 1 : `vocal_seg_${segments.length}`;
          segments.push({
            ...template,
            id: segId as any,
            note_name: `${NOTE_NAMES[((rMidi % 12) + 12) % 12]}${octave}`,
            midi: rMidi,
            frequency: Math.round(440 * Math.pow(2, (medMidi - 69) / 12) * 100) / 100,
            start: Math.round(segStart * 1000) / 1000,
            end: Math.round(endT * 1000) / 1000,
            duration: Math.max(0.1, Math.round((endT - segStart) * 1000) / 1000),
            cents_deviation: Math.round((medMidi - rMidi) * 1000) / 10,
            confidence: 0.95,
          });
        }
        segStart = -1;
        segMidis = [];
      }

      if (pt.midi > 0) {
        if (segStart < 0) segStart = pt.time;
        segMidis.push(pt.midi);
      }
    }
    return segments.length > 0 ? segments : effectiveNotes;
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
    livePitchRef.current = null;
    recentMicMidisRef.current = [];
    smoothedMidiRef.current = null;
    if (blindMode) {
      setShowPostBlindAnalysis(true);
    }

    const recordedPitches = [...userPitchHistory.current];
    setIsEvaluating(true);
    try {
      const evalTargetNotes =
        practiceMode === 'note' && selectedNote
          ? [selectedNote]
          : effectiveNotes;
      const tolerance = studioType === 'vocal' ? 60.0 : 70.0;
      const resp = await evaluatePractice(evalTargetNotes, recordedPitches, tolerance, studioType);
      setEvaluation(resp);

      const currentSettings: PracticeConfigSettings = {
        mode: practiceMode,
        target_note_name: practiceMode === 'note' && selectedNote ? selectedNote.note_name : undefined,
        target_midi: practiceMode === 'note' && selectedNote ? selectedNote.midi : undefined,
        playback_speed: playbackSpeed,
        transpose_semitones: transposeSemitones,
        tolerance_cents: tolerance,
      };

      const sessionAudio = audioInfo || {
        id: audioId,
        filename: `${transcription.key_estimate || 'Melody'}_practice.wav`,
        duration: duration,
      };

      recordPracticeSession(sessionAudio, currentSettings, resp);
      await recordPerformanceToProject(
        currentProjectId || audioId,
        sessionAudio,
        currentSettings,
        resp
      );
      onPracticeModified?.();
    } catch (err: any) {
      console.error('Evaluation error:', err?.message || JSON.stringify(err));
    } finally {
      setIsEvaluating(false);
      isStoppingRef.current = false;
    }
  };

  const handleImportPerformanceClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handlePerformanceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const tolerance = studioType === 'vocal' ? 60.0 : 70.0;
      const resp = await evaluateRecordedPerformance(audioId, file, tolerance, transposeSemitones, studioType);

      if (resp.performance_contour && resp.performance_contour.length > 0) {
        userPitchHistory.current = resp.performance_contour;
      }
      setEvaluation(resp);

      const currentSettings: PracticeConfigSettings = {
        mode: practiceMode,
        target_note_name: practiceMode === 'note' && selectedNote ? selectedNote.note_name : undefined,
        target_midi: practiceMode === 'note' && selectedNote ? selectedNote.midi : undefined,
        playback_speed: playbackSpeed,
        transpose_semitones: transposeSemitones,
        tolerance_cents: tolerance,
      };

      const sessionAudio = audioInfo || {
        id: audioId,
        filename: `${transcription.key_estimate || 'Melody'}_practice.wav`,
        duration: duration,
      };

      recordPracticeSession(sessionAudio, currentSettings, resp);
      await recordPerformanceToProject(
        currentProjectId || audioId,
        sessionAudio,
        currentSettings,
        resp
      );
      onPracticeModified?.();
      drawPracticeCanvas();
    } catch (err: any) {
      alert(`Performance evaluation failed: ${err.message || 'Error evaluating audio file'}`);
    } finally {
      setIsImporting(false);
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

  // Helper to check if user sang near a reference contour point ONLY for already-passed timestamps
  const isReferencePointMatchedByUser = (
    t: number,
    refMidi: number,
    currentTime: number,
    history: PitchFrame[]
  ): boolean => {
    // NEVER light up points ahead of the playhead (future timeline must stay dim until reached!)
    if (t > currentTime) return false;
    if (history.length === 0) return false;

    let lo = 0;
    let hi = history.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (history[mid].time < t - 0.18) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < history.length; i++) {
      const pt = history[i];
      if (pt.time > Math.min(currentTime, t + 0.18)) break;
      if (Math.abs(pt.midi - refMidi) <= 0.85) {
        return true;
      }
    }
    return false;
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
    } else if (isPracticing && !isStoppingRef.current && practiceMode === 'note' && selectedNote && !loopNote) {
      // Single note practice without looping: complete session when note ends
      if (currentTime >= selectedNote.end + 0.25) {
        isStoppingRef.current = true;
        stopPracticeSession();
      }
    } else if (isPracticing && !isStoppingRef.current && practiceMode === 'full' && audioRef.current) {
      // Full practice watchdog: auto-complete if playback reached the end
      if (audioRef.current.ended || (duration > 0 && currentTime >= duration - 0.08)) {
        isStoppingRef.current = true;
        stopPracticeSession();
      }
    }

    // Smoothly update digital clock display
    const nowPerf = performance.now();
    if (nowPerf - lastDisplayUpdateRef.current > 40) {
      lastDisplayUpdateRef.current = nowPerf;
      setCurrentTimeDisplay(currentTime);
    }

    // Pitch Range derived from clean contour or notes
    const validContourMidis = rawContour.filter((p) => p.midi > 0).map((p) => p.midi);
    const allMidis = validContourMidis.length > 0 ? validContourMidis : effectiveNotes.map((n) => n.midi);
    const minMidi = allMidis.length > 0 ? Math.max(36, Math.floor(Math.min(...allMidis)) - 2) : 48;
    const maxMidi = allMidis.length > 0 ? Math.min(84, Math.ceil(Math.max(...allMidis)) + 2) : 72;
    const midiRange = maxMidi - minMidi || 12;

    const axisY = height - 20;
    const hideReferenceGraph = blindMode && isPracticing;

    // =========================================================================
    // VOCAL  MODE: Zoomed Scrolling Timeline with Centered Fixed Playhead
    // =========================================================================
    if (studioType === 'vocal') {
      const leftMargin = 38;
      const plotWidth = width - leftMargin;
      const centerX = leftMargin + plotWidth * 0.45;
      const pixelsPerSecond = 145;

      const timeToX = (t: number) => centerX + (t - currentTime) * pixelsPerSecond;
      const midiToY = (m: number) => height - ((m - minMidi) / midiRange) * (height - 48) - 28;

      // 1. Subtle Horizontal Staff Lines & Left Note Axis
      for (let m = minMidi; m <= maxMidi; m++) {
        const y = midiToY(m);
        ctx.strokeStyle = m % 12 === 0 ? 'rgba(51, 65, 85, 0.4)' : 'rgba(30, 41, 59, 0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(leftMargin, y);
        ctx.lineTo(width, y);
        ctx.stroke();

        const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const octave = Math.floor(m / 12);
        ctx.fillStyle = m % 12 === 0 ? '#94a3b8' : '#475569';
        ctx.font = '9px monospace';
        ctx.fillText(`${NOTE_NAMES[m % 12]}${octave}`, 6, y + 3);
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(leftMargin, 0, plotWidth, axisY);
      ctx.clip();

      const history = userPitchHistory.current;

      // 2. Single Main Reference Vocal Contour (Dim Neon Green ahead -> Bright Neon Green ONLY behind playhead when matched)
      if (!hideReferenceGraph && rawContour.length > 1) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let i = 1; i < rawContour.length; i++) {
          const p1 = rawContour[i - 1];
          const p2 = rawContour[i];
          if (p1.midi <= 0 || p2.midi <= 0 || p2.time - p1.time > 0.18) continue;

          // Prevent drawing vertical plummeting artifact lines across sudden sub-harmonic octave drops
          const dt = p2.time - p1.time;
          const dm = Math.abs(p2.midi - p1.midi);
          if (dm > 5.5 && dt < 0.05) continue;

          const x1 = timeToX(p1.time);
          const x2 = timeToX(p2.time);
          if (x2 < leftMargin - 20 || x1 > width + 20) continue;

          const y1 = midiToY(p1.midi);
          const y2 = midiToY(p2.midi);

          const isMatched = isReferencePointMatchedByUser(p2.time, p2.midi, currentTime, history);

          if (isMatched) {
            ctx.strokeStyle = '#39ff14';
            ctx.lineWidth = 5;
            ctx.shadowColor = '#39ff14';
            ctx.shadowBlur = 12;
          } else {
            ctx.strokeStyle = 'rgba(57, 255, 20, 0.26)';
            ctx.lineWidth = 3.5;
            ctx.shadowBlur = 0;
          }

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;

        // Subtle note labels along sustained plateaus
        effectiveNotes.forEach((n) => {
          if (n.duration < 0.28) return;
          const nx = timeToX(n.start);
          if (nx < leftMargin || nx > width) return;
          const refY = getTargetMidiAtTime(n.start + 0.05) ?? n.midi;
          const ny = midiToY(refY);
          ctx.fillStyle = 'rgba(134, 239, 172, 0.65)';
          ctx.font = 'bold 9px monospace';
          ctx.fillText(n.note_name, nx + 2, ny - 9);
        });
      } else if (hideReferenceGraph) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('BLIND MEMORY MODE — Sing from memory', leftMargin + plotWidth / 2, height / 2);
        ctx.textAlign = 'left';
      }

      // 3. Off-Pitch User Trace (Drawn smoothly in Red ONLY behind playhead where user sings genuinely off-pitch)
      if (history.length > 1) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let i = 1; i < history.length; i++) {
          const p1 = history[i - 1];
          const p2 = history[i];
          if (p2.time - p1.time > 0.18 || p2.time > currentTime || (Math.abs(p2.midi - p1.midi) > 6.0 && p2.time - p1.time < 0.05)) continue;

          const x1 = timeToX(p1.time);
          const x2 = timeToX(p2.time);
          if (x2 < leftMargin - 20 || x1 > width + 20) continue;

          const isMatched = isUserPitchMatchedWithWindow(p2.time, p2.midi);
          if (isMatched && !hideReferenceGraph) continue;

          const y1 = midiToY(p1.midi);
          const y2 = midiToY(p2.midi);

          ctx.strokeStyle = hideReferenceGraph ? '#38bdf8' : '#ef4444';
          ctx.lineWidth = 3.2;
          ctx.shadowColor = hideReferenceGraph ? '#38bdf8' : '#ef4444';
          ctx.shadowBlur = 8;

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }

      ctx.restore();

      // 4. Scrolling Bottom Time Axis
      ctx.fillStyle = '#0a101d';
      ctx.fillRect(0, axisY, width, 20);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftMargin, axisY);
      ctx.lineTo(width, axisY);
      ctx.stroke();

      const startSec = Math.max(0, Math.floor(currentTime - (centerX - leftMargin) / pixelsPerSecond));
      const endSec = Math.min(Math.ceil(duration), Math.ceil(currentTime + (width - centerX) / pixelsPerSecond));
      ctx.fillStyle = '#64748b';
      ctx.font = '9px monospace';
      for (let t = startSec; t <= endSec; t += 1) {
        const tx = timeToX(t);
        if (tx < leftMargin || tx > width) continue;
        ctx.strokeStyle = '#334155';
        ctx.beginPath();
        ctx.moveTo(tx, axisY);
        ctx.lineTo(tx, axisY + 4);
        ctx.stroke();
        ctx.fillText(`${t}s`, tx - 6, height - 6);
      }

      // 5. Fixed Center Playhead Line & Live Pitch Ball Pointer
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, axisY);
      ctx.stroke();

      const currentLive = livePitchRef.current;
      const targetMidiNow = getTargetMidiAtTime(currentTime);
      let pointerMidi: number | null = null;
      let isPointerInTune = true;

      if (isPracticing && currentLive?.isVoiced) {
        pointerMidi = currentLive.midi;
        isPointerInTune = isUserPitchMatchedWithWindow(Math.max(0, currentTime - 0.15), currentLive.midi);
      } else if (targetMidiNow !== null && !hideReferenceGraph) {
        pointerMidi = targetMidiNow;
        isPointerInTune = true;
      }

      if (pointerMidi !== null) {
        const clampedMidi = Math.max(minMidi, Math.min(maxMidi, pointerMidi));
        const ballY = midiToY(clampedMidi);
        const ballColor =
          isPracticing && currentLive?.isVoiced
            ? (hideReferenceGraph ? '#38bdf8' : isPointerInTune ? '#39ff14' : '#ef4444')
            : '#39ff14';

        ctx.save();
        ctx.fillStyle = ballColor;
        ctx.shadowColor = ballColor;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(centerX, ballY, 6.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // Floating Current Second Badge on Fixed Center Playhead
      const timeText = `${currentTime.toFixed(2)}s`;
      ctx.font = 'bold 10px monospace';
      const textMetrics = ctx.measureText(timeText);
      const badgeW = textMetrics.width + 12;
      const badgeH = 18;
      const badgeX = centerX - badgeW / 2;
      const badgeY = 6;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      ctx.strokeStyle = '#39ff14';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(timeText, badgeX + 6, badgeY + 13);
      return;
    }

    // =========================================================================
    // INSTRUMENT MODE: Scrolling Notes Moving Toward Rectangular Gate Pointer
    // =========================================================================
    const leftMargin = 38;
    const plotWidth = width - leftMargin;
    const gateX = leftMargin + plotWidth * 0.25;
    const gateWidth = 22;
    const pixelsPerSecond = 145;

    const timeToX = (t: number) => gateX + (t - currentTime) * pixelsPerSecond;
    const midiToY = (m: number) => height - ((m - minMidi) / midiRange) * (height - 48) - 34;

    // 1. Horizontal Pitch Guides
    for (let m = minMidi; m <= maxMidi; m++) {
      const y = midiToY(m);
      ctx.strokeStyle = m % 12 === 0 ? '#334155' : '#111827';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftMargin, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const octave = Math.floor(m / 12);
      ctx.fillStyle = m % 12 === 0 ? '#94a3b8' : '#475569';
      ctx.font = '9px monospace';
      ctx.fillText(`${NOTE_NAMES[m % 12]}${octave}`, 6, y + 3);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(leftMargin, 0, plotWidth, axisY);
    ctx.clip();

    // 2. Incoming Note Blocks Scrolling Toward the Gate
    const currentLive = livePitchRef.current;
    let activeGateNote: NoteItem | null = null;

    if (!hideReferenceGraph) {
      effectiveNotes.forEach((n, idx) => {
        const x = timeToX(n.start);
        const w = Math.max(16, n.duration * pixelsPerSecond);
        if (x + w < leftMargin - 20 || x > width + 20) return;

        const y = midiToY(n.midi);
        const isInsideGate = currentTime >= n.start - 0.08 && currentTime <= n.end + 0.08;
        if (isInsideGate) {
          activeGateNote = n;
        }
        const isSelectedInNoteMode = practiceMode === 'note' && idx === selectedNoteIndex;

        if (practiceMode === 'note') {
          if (isSelectedInNoteMode) {
            ctx.fillStyle = 'rgba(245, 158, 11, 0.45)';
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2.5;
            ctx.shadowColor = '#f59e0b';
            ctx.shadowBlur = 12;
          } else {
            ctx.fillStyle = 'rgba(14, 165, 233, 0.08)';
            ctx.strokeStyle = 'rgba(14, 165, 233, 0.25)';
            ctx.lineWidth = 1;
            ctx.shadowBlur = 0;
          }
        } else {
          ctx.fillStyle = isInsideGate ? 'rgba(56, 189, 248, 0.45)' : 'rgba(14, 165, 233, 0.22)';
          ctx.strokeStyle = isInsideGate ? '#38bdf8' : 'rgba(14, 165, 233, 0.65)';
          ctx.lineWidth = isInsideGate ? 2.2 : 1.2;
          ctx.shadowBlur = isInsideGate ? 10 : 0;
          ctx.shadowColor = '#38bdf8';
        }

        ctx.beginPath();
        ctx.roundRect(x, y, w, 18, 5);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = isSelectedInNoteMode ? '#fef08a' : isInsideGate ? '#ffffff' : '#bae6fd';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(n.note_name, x + 5, y + 12);
      });
    }

    // 3. Linear Timeline Playhead (حالت خطی)
    let lineStroke = 'rgba(56, 189, 248, 0.45)';
    let lineGlow = 'transparent';

    if (isPracticing && currentLive?.isVoiced) {
      const targetNote = practiceMode === 'note' && selectedNote ? selectedNote : activeGateNote;
      if (targetNote) {
        const semitoneDiff = Math.abs(currentLive.midi - targetNote.midi);
        const isCorrectNote = semitoneDiff <= 0.85 || Math.round(currentLive.midi) === targetNote.midi;
        if (isCorrectNote) {
          lineStroke = '#39ff14';
          lineGlow = '#39ff14';
        } else {
          lineStroke = '#ef4444';
          lineGlow = '#ef4444';
        }
      } else {
        // In inter-note gaps / transitions: keep line neutral
        lineStroke = 'rgba(148, 163, 184, 0.55)';
        lineGlow = 'transparent';
      }
    }

    // Sleek Linear Timeline Playhead Line (حالت خطی)
    ctx.save();
    ctx.strokeStyle = lineStroke;
    ctx.lineWidth = isPracticing && currentLive?.isVoiced ? 2.5 : 1.8;
    if (lineGlow !== 'transparent') {
      ctx.shadowColor = lineGlow;
      ctx.shadowBlur = 14;
    }
    ctx.beginPath();
    ctx.moveTo(gateX, 0);
    ctx.lineTo(gateX, axisY);
    ctx.stroke();
    ctx.restore();

    // Live Note Hit / Pointer Indicator at the Linear Timeline
    if (isPracticing && currentLive?.isVoiced) {
      const clampedMidi = Math.max(minMidi, Math.min(maxMidi, currentLive.midi));
      const userGateY = midiToY(clampedMidi) + 9;
      ctx.save();
      ctx.fillStyle = lineStroke;
      ctx.shadowColor = lineStroke;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(gateX, userGateY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    // 4. Bottom Scrolling Time Axis
    ctx.fillStyle = '#0a101d';
    ctx.fillRect(0, axisY, width, 20);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftMargin, axisY);
    ctx.lineTo(width, axisY);
    ctx.stroke();

    const startSec = Math.max(0, Math.floor(currentTime - (gateX - leftMargin) / pixelsPerSecond));
    const endSec = Math.min(Math.ceil(duration), Math.ceil(currentTime + (width - gateX) / pixelsPerSecond));
    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    for (let t = startSec; t <= endSec; t += 1) {
      const tx = timeToX(t);
      if (tx < leftMargin || tx > width) continue;
      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(tx, axisY);
      ctx.lineTo(tx, axisY + 4);
      ctx.stroke();
      ctx.fillText(`${t}s`, tx - 6, height - 6);
    }

    const timeText = `${currentTime.toFixed(2)}s`;
    ctx.font = 'bold 10px monospace';
    const textMetrics = ctx.measureText(timeText);
    const badgeW = textMetrics.width + 12;
    const badgeH = 18;
    const badgeX = gateX - badgeW / 2;
    const badgeY = 4;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.strokeStyle = lineStroke;
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
  }, [currentTimeFromAudio(audioRef.current), transposeSemitones, practiceMode, selectedNoteIndex, studioType, blindMode, showPostBlindAnalysis]);

  // Click directly on canvas to select and audition a note
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || effectiveNotes.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const currentTime = audioRef.current ? audioRef.current.currentTime : 0;
    const leftMargin = 38;
    const plotWidth = width - leftMargin;
    const anchorX = studioType === 'instrument' ? leftMargin + plotWidth * 0.25 : leftMargin + plotWidth * 0.45;
    const pixelsPerSecond = 145;

    const validContourMidis = rawContour.filter((p) => p.midi > 0).map((p) => p.midi);
    const allMidis = validContourMidis.length > 0 ? validContourMidis : effectiveNotes.map((n) => n.midi);
    const minMidi = allMidis.length > 0 ? Math.max(36, Math.floor(Math.min(...allMidis)) - 2) : 48;
    const maxMidi = allMidis.length > 0 ? Math.min(84, Math.ceil(Math.max(...allMidis)) + 2) : 72;
    const midiRange = maxMidi - minMidi || 12;

    for (let i = 0; i < effectiveNotes.length; i++) {
      const n = effectiveNotes[i];
      const nx = anchorX + (n.start - currentTime) * pixelsPerSecond;
      const nw = Math.max(16, n.duration * pixelsPerSecond);
      const ny = height - ((n.midi - minMidi) / midiRange) * (height - 48) - 34;
      const nh = 18;

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
        onEnded={() => {
          if (!isStoppingRef.current) {
            isStoppingRef.current = true;
            stopPracticeSession();
          }
        }}
        onTimeUpdate={(e) => {
          const ct = e.currentTarget.currentTime;
          setCurrentTimeDisplay(ct);
          if (isPracticing && !isStoppingRef.current && practiceMode === 'full' && duration > 0) {
            if (e.currentTarget.ended || ct >= duration - 0.08) {
              isStoppingRef.current = true;
              stopPracticeSession();
            }
          }
        }}
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

            {/* Start / Finish Action Button & Imported Performance Option */}
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
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleStartPracticeClick}
                    className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold rounded-xl text-sm shadow-lg shadow-emerald-500/25 transition-all"
                  >
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                    {practiceMode === 'note' ? 'Practice Note' : 'Start Practice Session'}
                  </button>
                  <button
                    onClick={handleImportPerformanceClick}
                    disabled={isImporting}
                    className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 border border-slate-700/80 hover:border-slate-600 hover:bg-slate-800 text-slate-200 font-semibold rounded-xl text-sm shadow-sm transition-all"
                    title="Import an audio recording of your performance to evaluate against reference"
                  >
                    <Upload className="w-4 h-4 text-cyan-400" />
                    {isImporting ? 'Analyzing Take...' : 'Import Performance'}
                  </button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handlePerformanceFileChange}
                    accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
                    className="hidden"
                  />
                </div>
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

        {/* Practice Mode Switcher (Vocal vs Instrument + Full Song vs Note-by-Note + Blind Mode) */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center gap-2">
            {/* Domain Mode: Vocal vs Instrument */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800">
              <button
                onClick={() => setStudioType('vocal')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  studioType === 'vocal'
                    ? 'bg-emerald-950/60 border border-emerald-500/60 text-emerald-300 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Mic2 className="w-3.5 h-3.5" />
                <span>Vocal</span>
              </button>
              <button
                onClick={() => setStudioType('instrument')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  studioType === 'instrument'
                    ? 'bg-cyan-950 border border-cyan-700/60 text-cyan-300 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Piano className="w-3.5 h-3.5" />
                <span>Instrument</span>
              </button>
            </div>

            {/* Phrase Scope: Full Song vs Note-by-Note */}
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

            {/* Blind Memory Mode Toggle */}
            <button
              onClick={() => {
                setBlindMode((prev) => !prev);
                setShowPostBlindAnalysis(false);
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                blindMode
                  ? 'bg-purple-950/60 border-purple-500/60 text-purple-300 shadow-sm'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title="Hide target graph while singing to test memorization, then reveal comparison after stopping"
            >
              {blindMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>Blind Mode: {blindMode ? 'On' : 'Off'}</span>
            </button>
          </div>

          <div className="text-xs text-slate-500">
            {practiceMode === 'note'
              ? 'Click any note on the timeline or use buttons below to switch target'
              : studioType === 'vocal'
              ? 'Zoomed scrolling contour — center cursor tracks your voice in real time'
              : 'Rhythm Gate mode — play notes accurately as they pass through the gate'}
          </div>
        </div>

        {/* Note-by-Note Dedicated Control Toolbar */}
        {practiceMode === 'note' && (
          <div
            className="p-3.5 rounded-xl bg-slate-950/80 flex flex-col gap-2.5 w-full"
            style={{ border: 'none' }}
          >
            {/* Top Row: Note Stepping & Audition Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 w-full">
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
              </div>

              {/* Action Buttons: Hear Pitch & Loop Note */}
              <div className="flex items-center gap-2">
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
            </div>

            {/* Bottom Row: Quick Note Selector Carousel (Always starts on its own line) */}
            <div className="w-full">
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
                    style={{ width: '74px', minWidth: '74px', maxWidth: '74px' }}
                    className={`h-8 rounded-lg text-xs font-mono font-bold transition-all shrink-0 flex items-center justify-center text-center ${
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
          <span className={`flex items-center gap-1.5 ${studioType === 'vocal' ? 'text-emerald-300' : 'text-cyan-300'}`}>
            <span className={`w-3 h-2 rounded-xs ${studioType === 'vocal' ? 'bg-[#39ff14]/30 border border-[#39ff14]' : 'bg-cyan-500/30 border border-cyan-400'}`}></span>
            {studioType === 'vocal' ? 'Main Vocal Contour (Lights up Bright Neon Green when matched)' : 'Incoming Notes -> Rectangular Gate'}
          </span>
          <span className="flex items-center gap-1.5 text-rose-300">
            <span className="w-2.5 h-2.5 bg-rose-500 rounded-full"></span>
            {studioType === 'vocal' ? 'Off-Pitch Singing Trace (Red)' : 'Gate Turns Green on Hit / Red on Wrong Note'}
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
                    ? `Get ready for note: ${selectedNote.note_name} (${countdownValue})`
                    : `Get ready for the track (${countdownValue})`}
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
          currentProjectId={currentProjectId}
          onClose={() => setIsHistoryOpen(false)}
          onOpenProject={(proj) => {
            setIsHistoryOpen(false);
            if (onOpenProject) {
              onOpenProject(proj);
            } else if (onRestoreTrack && proj.transcription) {
              onRestoreTrack(
                proj.audioInfo,
                proj.transcription,
                proj.practiceSettings || {
                  mode: 'full',
                  playback_speed: 1.0,
                  transpose_semitones: 0,
                  tolerance_cents: 50.0,
                }
              );
            }
          }}
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