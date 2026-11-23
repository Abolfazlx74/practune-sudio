import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, X, AlertCircle, Sparkles } from 'lucide-react';

interface AudioRecorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRecordingComplete: (file: File) => void;
}

export function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
}

export const AudioRecorderModal: React.FC<AudioRecorderModalProps> = ({
  isOpen,
  onClose,
  onRecordingComplete,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visualizerBars, setVisualizerBars] = useState<number[]>(new Array(24).fill(4));

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const recordedChunksRef = useRef<Float32Array[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const cleanupAudio = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setIsRecording(false);
    setVisualizerBars(new Array(24).fill(4));
  };

  useEffect(() => {
    if (!isOpen) {
      cleanupAudio();
      setDurationSec(0);
      setErrorMessage(null);
    }
    return () => cleanupAudio();
  }, [isOpen]);

  const startRecording = async () => {
    setErrorMessage(null);
    recordedChunksRef.current = [];
    setDurationSec(0);

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      const bufferSize = 4096;
      const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
      scriptProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        recordedChunksRef.current.push(new Float32Array(inputData));
      };

      source.connect(analyser);
      analyser.connect(processor);

      // Connect to zero-gain node to keep Chrome audio thread active without feedback
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(ctx.destination);

      setIsRecording(true);

      // Start duration counter
      const startTime = Date.now();
      timerIntervalRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setDurationSec(elapsed);
      }, 250);

      // Start live frequency visualizer animation
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVisualizer = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        const bars: number[] = [];
        const step = Math.max(1, Math.floor(dataArray.length / 24));
        for (let i = 0; i < 24; i++) {
          const val = dataArray[i * step] || 0;
          const height = Math.max(4, Math.round((val / 255) * 48));
          bars.push(height);
        }
        setVisualizerBars(bars);
        animFrameRef.current = requestAnimationFrame(updateVisualizer);
      };
      updateVisualizer();
    } catch (err: any) {
      console.error('Microphone error:', err);
      setErrorMessage(
        err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
          ? 'Microphone access denied. Please grant microphone permission in your browser.'
          : `Could not access microphone: ${err.message || 'Unknown error'}`
      );
      cleanupAudio();
    }
  };

  const stopAndImport = () => {
    const ctx = audioContextRef.current;
    const sampleRate = ctx ? ctx.sampleRate : 44100;

    cleanupAudio();

    const chunks = recordedChunksRef.current;
    let totalSamples = 0;
    for (const c of chunks) {
      totalSamples += c.length;
    }

    if (totalSamples < sampleRate * 0.6) {
      setErrorMessage('Recording is too short! Please record for at least 1 second.');
      return;
    }

    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const wavBytes = encodeWAV(merged, sampleRate);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const recordedFile = new File([wavBytes], `recorded_track_${timestamp}.wav`, {
      type: 'audio/wav',
    });

    onRecordingComplete(recordedFile);
    onClose();
  };

  const handleCancel = () => {
    cleanupAudio();
    onClose();
  };

  if (!isOpen) return null;

  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  const timeFormatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in select-none">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-7 relative overflow-hidden flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-2xl border transition-all ${
              isRecording
                ? 'bg-rose-950/80 border-rose-500/60 text-rose-400 shadow-lg shadow-rose-500/20'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}>
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Record New Audio Track
              </h3>
              <p className="text-xs text-slate-400">
                Capture your voice or instrument live
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="p-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error notification if mic blocked */}
        {errorMessage && (
          <div className="p-3.5 rounded-2xl bg-rose-950/60 border border-rose-500/50 text-rose-300 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Main Recording Display */}
        <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-slate-950/60 border border-slate-800/80 gap-4">
          {/* Status Badge & Pulse */}
          <div className="flex items-center justify-center">
            {isRecording ? (
              <div className="relative flex items-center justify-center">
                <div className="w-20 h-20 rounded-full bg-rose-500/20 animate-ping absolute inset-0" />
                <div className="w-20 h-20 rounded-full bg-rose-950/90 border-2 border-rose-500 shadow-xl shadow-rose-500/30 flex items-center justify-center relative">
                  <Mic className="w-8 h-8 text-rose-400 animate-pulse" />
                </div>
              </div>
            ) : (
              <div className="w-20 h-20 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center shadow-inner">
                <Mic className="w-8 h-8 text-slate-500" />
              </div>
            )}
          </div>

          {/* Stopwatch Digital Clock */}
          <div className="flex flex-col items-center">
            <span className={`text-4xl font-mono font-bold tracking-wider ${
              isRecording ? 'text-white' : 'text-slate-500'
            }`}>
              {timeFormatted}
            </span>
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase mt-1">
              {isRecording ? 'Recording Live Audio...' : 'Ready to record'}
            </span>
          </div>

          {/* Dynamic Frequency Waveform Bars */}
          <div className="flex items-end justify-center gap-1 h-12 w-full px-4 pt-2">
            {visualizerBars.map((h, i) => (
              <div
                key={i}
                className={`w-1.5 rounded-full transition-all duration-75 ${
                  isRecording
                    ? 'bg-gradient-to-t from-cyan-500 to-rose-400'
                    : 'bg-slate-800'
                }`}
                style={{ height: `${h}px` }}
              />
            ))}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {!isRecording ? (
            <button
              onClick={startRecording}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-5 rounded-2xl bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-400 hover:to-red-500 text-white font-bold text-xs shadow-lg shadow-rose-500/25 transition-all cursor-pointer"
            >
              <Mic className="w-4 h-4" />
              Start Recording
            </button>
          ) : (
            <>
              <button
                onClick={stopAndImport}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/25 transition-all cursor-pointer"
              >
                <Square className="w-4 h-4 fill-slate-950" />
                Finish & Open in Studio
              </button>
              <button
                onClick={handleCancel}
                className="py-3 px-4 rounded-2xl bg-slate-950 hover:bg-slate-850 border border-slate-800 text-slate-400 hover:text-white font-semibold text-xs transition-all cursor-pointer"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
