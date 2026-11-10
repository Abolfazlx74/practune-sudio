import React, { useRef, useState, useEffect } from 'react';
import { ZoomIn, ZoomOut, Volume2, Move, Trash2, Undo2 } from 'lucide-react';
import type { NoteItem } from '../types';
import { synth } from '../services/synth';

interface PianoRollProps {
  notes: NoteItem[];
  currentTime: number;
  duration: number;
  onNotesChange?: (updatedNotes: NoteItem[]) => void;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIN_MIDI = 36; // C2
const MAX_MIDI = 84; // C6
const TOTAL_KEYS = MAX_MIDI - MIN_MIDI + 1;
const KEY_HEIGHT = 16;
const PIANO_WIDTH = 54;

export const PianoRoll: React.FC<PianoRollProps> = ({
  notes,
  currentTime,
  duration,
  onNotesChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoomX, setZoomX] = useState<number>(100); // pixels per second
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  // Drag editing state
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<'move' | 'resize' | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartY, setDragStartY] = useState(0);
  const [activeNotes, setActiveNotes] = useState<NoteItem[]>(notes);

  useEffect(() => {
    setActiveNotes(notes);
  }, [notes]);

  const totalWidth = Math.max(800, duration * zoomX + PIANO_WIDTH + 100);
  const totalHeight = TOTAL_KEYS * KEY_HEIGHT;

  // Auto-scroll to follow playhead
  useEffect(() => {
    if (!containerRef.current) return;
    const playheadX = currentTime * zoomX + PIANO_WIDTH;
    const container = containerRef.current;
    if (playheadX > container.scrollLeft + container.clientWidth - 150) {
      container.scrollLeft = playheadX - 100;
    }
  }, [currentTime, zoomX]);

  // Render Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = totalWidth;
    canvas.height = totalHeight;

    ctx.clearRect(0, 0, totalWidth, totalHeight);

    // 1. Draw Grid Rows & Key Backgrounds
    for (let m = MAX_MIDI; m >= MIN_MIDI; m--) {
      const y = (MAX_MIDI - m) * KEY_HEIGHT;
      const noteIdx = m % 12;
      const isBlack = [1, 3, 6, 8, 10].includes(noteIdx);

      // Grid line
      ctx.fillStyle = isBlack ? '#0c1222' : '#0f172a';
      ctx.fillRect(PIANO_WIDTH, y, totalWidth - PIANO_WIDTH, KEY_HEIGHT);

      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(PIANO_WIDTH, y + KEY_HEIGHT);
      ctx.lineTo(totalWidth, y + KEY_HEIGHT);
      ctx.stroke();

      // Left Piano Key
      ctx.fillStyle = isBlack ? '#1e293b' : '#334155';
      ctx.fillRect(0, y, PIANO_WIDTH - 2, KEY_HEIGHT - 1);

      ctx.fillStyle = isBlack ? '#94a3b8' : '#e2e8f0';
      ctx.font = '9px monospace';
      const octave = Math.floor(m / 12) - 1;
      const noteName = `${NOTE_NAMES[noteIdx]}${octave}`;
      if (!isBlack || noteIdx === 1 || noteIdx === 6) {
        ctx.fillText(noteName, 4, y + KEY_HEIGHT - 4);
      }
    }

    // 2. Draw Time Grid (Beats & Seconds)
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const step = zoomX >= 120 ? 0.25 : zoomX >= 60 ? 0.5 : 1.0;
    for (let t = 0; t <= duration; t += step) {
      const x = PIANO_WIDTH + t * zoomX;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalHeight);
      ctx.stroke();
    }

    // 3. Draw Note Rectangles
    activeNotes.forEach((n) => {
      const y = (MAX_MIDI - n.midi) * KEY_HEIGHT;
      const x = PIANO_WIDTH + n.start * zoomX;
      const w = Math.max(6, n.duration * zoomX);
      const isPlaying = currentTime >= n.start && currentTime <= n.end;
      const isSelected = selectedNoteId === n.id;

      // Note background
      if (isPlaying) {
        ctx.fillStyle = '#38bdf8'; // Glowing cyan
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 10;
      } else if (isSelected) {
        ctx.fillStyle = '#f59e0b'; // Amber
        ctx.shadowColor = '#d97706';
        ctx.shadowBlur = 8;
      } else {
        ctx.fillStyle = '#0284c7';
        ctx.shadowBlur = 0;
      }

      ctx.beginPath();
      ctx.roundRect(x, y + 1, w, KEY_HEIGHT - 2, 3);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Border
      ctx.strokeStyle = isSelected ? '#fbbf24' : isPlaying ? '#e0f2fe' : '#38bdf8';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Note text label
      if (w > 22) {
        ctx.fillStyle = isPlaying ? '#0f172a' : '#ffffff';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText(n.note_name, x + 4, y + KEY_HEIGHT - 4);
      }
    });

    // 4. Draw Playhead Cursor
    const cursorX = PIANO_WIDTH + currentTime * zoomX;
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, totalHeight);
    ctx.stroke();
  }, [activeNotes, currentTime, duration, zoomX, totalWidth, totalHeight, selectedNoteId]);

  // Mouse Interaction: Note Select & Synth Audition
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Check if clicked on piano key
    if (clickX < PIANO_WIDTH) {
      const keyIdx = Math.floor(clickY / KEY_HEIGHT);
      const midi = MAX_MIDI - keyIdx;
      synth.playMidiNote(midi);
      return;
    }

    // Check if clicked on a note
    const noteX = clickX - PIANO_WIDTH;
    const timeAtClick = noteX / zoomX;
    const clickedMidi = MAX_MIDI - Math.floor(clickY / KEY_HEIGHT);

    const hitNote = activeNotes.find(
      (n) => n.midi === clickedMidi && timeAtClick >= n.start && timeAtClick <= n.end
    );

    if (hitNote) {
      setSelectedNoteId(hitNote.id);
      synth.playMidiNote(hitNote.midi);

      // Check if clicking near right edge for resize
      const noteRightX = PIANO_WIDTH + hitNote.end * zoomX;
      if (Math.abs(clickX - noteRightX) < 10) {
        setDragMode('resize');
      } else {
        setDragMode('move');
      }
      setDraggingNoteId(hitNote.id);
      setDragStartX(clickX);
      setDragStartY(clickY);
    } else {
      setSelectedNoteId(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingNoteId || !dragMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const deltaX = (currentX - dragStartX) / zoomX;
    const deltaMidi = -Math.round((currentY - dragStartY) / KEY_HEIGHT);

    setActiveNotes((prev) =>
      prev.map((n) => {
        if (n.id !== draggingNoteId) return n;

        if (dragMode === 'resize') {
          const newDur = Math.max(0.08, n.duration + deltaX);
          return { ...n, duration: round(newDur, 2), end: round(n.start + newDur, 2) };
        } else {
          const newStart = Math.max(0, n.start + deltaX);
          const newMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, n.midi + deltaMidi));
          const octave = Math.floor(newMidi / 12) - 1;
          const noteName = `${NOTE_NAMES[newMidi % 12]}${octave}`;
          return {
            ...n,
            start: round(newStart, 2),
            end: round(newStart + n.duration, 2),
            midi: newMidi,
            note_name: noteName,
            octave,
          };
        }
      })
    );

    setDragStartX(currentX);
    setDragStartY(currentY);
  };

  const handleMouseUp = () => {
    if (draggingNoteId) {
      setDraggingNoteId(null);
      setDragMode(null);
      if (onNotesChange) {
        onNotesChange(activeNotes);
      }
    }
  };

  const handleDeleteSelected = () => {
    if (!selectedNoteId) return;
    const updated = activeNotes.filter((n) => n.id !== selectedNoteId);
    setActiveNotes(updated);
    setSelectedNoteId(null);
    if (onNotesChange) onNotesChange(updated);
  };

  const selectedNote = activeNotes.find((n) => n.id === selectedNoteId);

  return (
    <div className="daw-panel p-4 border border-slate-800 bg-slate-900/50 rounded-2xl space-y-3">
      {/* Piano Roll Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-200">Interactive Piano Roll</span>
          <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800/60 text-cyan-400 font-mono">
            {activeNotes.length} Notes Extracted
          </span>
          {selectedNote && (
            <div className="flex items-center gap-2 text-xs text-slate-300 bg-slate-950 px-3 py-1 rounded-lg border border-slate-800">
              <span>Selected: <strong className="text-amber-400">{selectedNote.note_name}</strong></span>
              <span>•</span>
              <span>Start: {selectedNote.start}s</span>
              <span>•</span>
              <span>Dur: {selectedNote.duration}s</span>
              <button
                onClick={handleDeleteSelected}
                className="ml-2 text-rose-400 hover:text-rose-300"
                title="Delete note"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Zoom & Helper */}
        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-400 flex items-center gap-1">
            <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>Click keys or notes to audition synth</span>
          </div>

          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setZoomX((z) => Math.max(40, z - 20))}
              className="p-1 text-slate-400 hover:text-slate-200"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono px-2 text-slate-400">{zoomX}px/s</span>
            <button
              onClick={() => setZoomX((z) => Math.min(240, z + 20))}
              className="p-1 text-slate-400 hover:text-slate-200"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Piano Roll Viewport */}
      <div
        ref={containerRef}
        className="overflow-x-auto overflow-y-auto max-h-[500px] border border-slate-800/90 rounded-xl bg-[#090d16] select-none"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="cursor-pointer block"
        />
      </div>
    </div>
  );
};

function round(val: number, dec: number): number {
  return Number(Math.round(Number(val + 'e' + dec)) + 'e-' + dec);
}
