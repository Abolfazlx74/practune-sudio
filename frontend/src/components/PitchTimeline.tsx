import React, { useRef, useEffect, useState } from 'react';
import { Activity, Eye } from 'lucide-react';
import type { PitchFrame, NoteItem } from '../types';

interface PitchTimelineProps {
  originalContour: PitchFrame[];
  simplifiedContour?: PitchFrame[];
  notes: NoteItem[];
  currentTime: number;
  duration: number;
  onSeek?: (time: number) => void;
}

export const PitchTimeline: React.FC<PitchTimelineProps> = ({
  originalContour,
  simplifiedContour,
  notes,
  currentTime,
  duration,
  onSeek,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showOriginal, setShowOriginal] = useState(true);
  const [showSimplified, setShowSimplified] = useState(true);
  const [showNotes, setShowNotes] = useState(true);

  // Pitch range: min and max MIDI notes in contour
  const allMidis = [
    ...originalContour.map((f) => f.midi),
    ...notes.map((n) => n.midi),
  ].filter((m) => m > 0);

  const minMidi = allMidis.length > 0 ? Math.max(36, Math.floor(Math.min(...allMidis)) - 2) : 48;
  const maxMidi = allMidis.length > 0 ? Math.min(84, Math.ceil(Math.max(...allMidis)) + 2) : 72;
  const midiRange = maxMidi - minMidi || 12;

  useEffect(() => {
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

    // Dark grid background
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, width, height);

    const dur = Math.max(1, duration);

    // Horizontal Pitch Guidelines
    for (let m = minMidi; m <= maxMidi; m++) {
      const y = height - ((m - minMidi) / midiRange) * (height - 30) - 15;
      ctx.strokeStyle = m % 12 === 0 ? '#334155' : '#1e293b';
      ctx.lineWidth = m % 12 === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      // Semitone Label
      if (m % 2 === 0 || m % 12 === 0) {
        const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const octave = Math.floor(m / 12) - 1;
        const name = `${NOTE_NAMES[m % 12]}${octave}`;
        ctx.fillStyle = '#64748b';
        ctx.font = '9px monospace';
        ctx.fillText(name, 6, y + 3);
      }
    }

    // 1. Draw Discrete Note Blocks
    if (showNotes) {
      notes.forEach((n) => {
        const x = 40 + (n.start / dur) * (width - 40);
        const w = (n.duration / dur) * (width - 40);
        const y = height - ((n.midi - minMidi) / midiRange) * (height - 30) - 20;

        ctx.fillStyle = 'rgba(14, 165, 233, 0.18)';
        ctx.strokeStyle = 'rgba(14, 165, 233, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, Math.max(4, w), 12, 3);
        ctx.fill();
        ctx.stroke();
      });
    }

    // 2. Draw Original Continuous Pitch Contour (Cyan trace)
    if (showOriginal && originalContour.length > 0) {
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;

      originalContour.forEach((frame, i) => {
        if (frame.midi < minMidi || frame.midi > maxMidi) {
          started = false;
          return;
        }

        const x = 40 + (frame.time / dur) * (width - 40);
        const y = height - ((frame.midi - minMidi) / midiRange) * (height - 30) - 15;

        // Break line if time gap is too large (> 0.08s)
        const prevFrame = originalContour[i - 1];
        if (!started || (prevFrame && frame.time - prevFrame.time > 0.08)) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    }

    // 3. Draw Simplified Contour (Amber/Green trace)
    if (showSimplified && simplifiedContour && simplifiedContour.length > 0) {
      ctx.strokeStyle = '#10b981'; // Emerald
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      let started = false;

      simplifiedContour.forEach((frame, i) => {
        if (frame.midi < minMidi || frame.midi > maxMidi) {
          started = false;
          return;
        }

        const x = 40 + (frame.time / dur) * (width - 40);
        const y = height - ((frame.midi - minMidi) / midiRange) * (height - 30) - 15;

        const prevFrame = simplifiedContour[i - 1];
        if (!started || (prevFrame && frame.time - prevFrame.time > 0.08)) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    }

    // 4. Playhead Line
    const cursorX = 40 + (currentTime / dur) * (width - 40);
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, height);
    ctx.stroke();
  }, [
    originalContour,
    simplifiedContour,
    notes,
    currentTime,
    duration,
    showOriginal,
    showSimplified,
    showNotes,
    minMidi,
    maxMidi,
    midiRange,
  ]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !onSeek) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left - 40;
    const usableW = rect.width - 40;
    if (clickX >= 0 && usableW > 0) {
      const time = (clickX / usableW) * duration;
      onSeek(Math.max(0, Math.min(duration, time)));
    }
  };

  return (
    <div className="daw-panel p-4 border border-slate-800 bg-slate-900/50 rounded-2xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-slate-200">Pitch Contour Timeline</span>
        </div>

        {/* Legend & Layer Toggles */}
        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer text-cyan-300">
            <input
              type="checkbox"
              checked={showOriginal}
              onChange={(e) => setShowOriginal(e.target.checked)}
              className="w-3.5 h-3.5 accent-cyan-400 rounded"
            />
            <span className="w-2.5 h-0.5 bg-cyan-400 rounded"></span>
            Original Pitch Contour
          </label>

          {simplifiedContour && (
            <label className="flex items-center gap-1.5 cursor-pointer text-emerald-300">
              <input
                type="checkbox"
                checked={showSimplified}
                onChange={(e) => setShowSimplified(e.target.checked)}
                className="w-3.5 h-3.5 accent-emerald-400 rounded"
              />
              <span className="w-2.5 h-0.5 bg-emerald-400 rounded"></span>
              Simplified (NewTone)
            </label>
          )}

          <label className="flex items-center gap-1.5 cursor-pointer text-sky-300">
            <input
              type="checkbox"
              checked={showNotes}
              onChange={(e) => setShowNotes(e.target.checked)}
              className="w-3.5 h-3.5 accent-sky-400 rounded"
            />
            <span className="w-3 h-2 bg-sky-500/30 border border-sky-400 rounded-xs"></span>
            Extracted Note Targets
          </label>
        </div>
      </div>

      <div className="relative rounded-xl overflow-hidden border border-slate-800/90 bg-[#080c14]">
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="w-full h-64 cursor-pointer block"
        />
      </div>
    </div>
  );
};
