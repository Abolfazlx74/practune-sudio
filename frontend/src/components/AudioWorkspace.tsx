import React, { useRef, useState, useEffect } from 'react';
import {
  Play,
  Pause,
  Square,
  Upload,
  Volume2,
  SlidersHorizontal,
  Sparkles,
  RefreshCw,
  Clock,
  Layers,
  CheckCircle2,
  FileAudio,
  Radio,
  Scissors,
  Check,
  X,
} from 'lucide-react';
import type { AudioInfo, PreprocessOptions } from '../types';
import {
  getAudioFileUrl,
  preprocessAudio,
  transcribeAudio,
  uploadAudio,
  trimAudio,
} from '../services/api';

interface AudioWorkspaceProps {
  audioInfo: AudioInfo | null;
  onAudioSelected: (audio: AudioInfo) => void;
  onTranscriptionComplete: (data: any) => void;
  isTranscribing: boolean;
  setIsTranscribing: (val: boolean) => void;
}

export const AudioWorkspace: React.FC<AudioWorkspaceProps> = ({
  audioInfo,
  onAudioSelected,
  onTranscriptionComplete,
  isTranscribing,
  setIsTranscribing,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isLooping, setIsLooping] = useState(false);
  const [rangeStart, setRangeStart] = useState<number>(0);
  const [rangeEnd, setRangeEnd] = useState<number>(0);
  const [isRangeActive, setIsRangeActive] = useState(false);

  // Cut / Trim Tool States
  // 'idle' -> 'start-set' -> 'end-set'
  const [cutStep, setCutStep] = useState<'idle' | 'start-set' | 'end-set'>('idle');
  const [cutStart, setCutStart] = useState<number | null>(null);
  const [cutEnd, setCutEnd] = useState<number | null>(null);
  const [isTrimming, setIsTrimming] = useState(false);
  const [trimNotice, setTrimNotice] = useState<string | null>(null);

  // Preprocessing states
  const [noiseReduction, setNoiseReduction] = useState(false);
  const [noiseIntensity, setNoiseIntensity] = useState(0.5);
  const [normalize, setNormalize] = useState(true);
  const [isProcessingDsp, setIsProcessingDsp] = useState(false);

  // A/B Audio comparison
  const [activeVersion, setActiveVersion] = useState<'original' | 'processed'>('original');
  const [processedAudio, setProcessedAudio] = useState<AudioInfo | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const activeAudio = activeVersion === 'processed' && processedAudio ? processedAudio : audioInfo;

  useEffect(() => {
    if (activeAudio) {
      setRangeStart(0);
      setRangeEnd(activeAudio.duration);
      setCurrentTime(0);
      setIsPlaying(false);
      // Reset cut state on new audio load
      setCutStep('idle');
      setCutStart(null);
      setCutEnd(null);
    }
  }, [activeAudio?.id]);

  // Audio Playback & Animation Frame
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (isLooping && isRangeActive && audio.currentTime >= rangeEnd) {
        audio.currentTime = rangeStart;
        audio.play();
      }
    };

    const handleEnded = () => {
      if (isLooping) {
        audio.currentTime = isRangeActive ? rangeStart : 0;
        audio.play();
      } else {
        setIsPlaying(false);
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [isLooping, isRangeActive, rangeStart, rangeEnd]);

  // Render Interactive Waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeAudio) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    // Background grid
    ctx.fillStyle = '#070b12';
    ctx.fillRect(0, 0, width, height);

    // Subtle time markers
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const duration = activeAudio.duration || 1;
    const numMarkers = 8;
    for (let i = 0; i <= numMarkers; i++) {
      const x = (i / numMarkers) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      const timeText = ((i / numMarkers) * duration).toFixed(1) + 's';
      ctx.fillStyle = '#475569';
      ctx.font = '10px monospace';
      ctx.fillText(timeText, x + 4, 12);
    }

    // Waveform peaks
    const peaks = activeAudio.waveform_overview.length > 0
      ? activeAudio.waveform_overview
      : Array(120).fill(0.3);
    const barWidth = width / peaks.length;
    const halfH = height / 2;

    peaks.forEach((peak, i) => {
      const x = i * barWidth;
      const barH = Math.max(2, peak * (height * 0.72));
      const peakTime = (i / peaks.length) * duration;
      const isPast = peakTime <= currentTime;

      const gradient = ctx.createLinearGradient(0, halfH - barH / 2, 0, halfH + barH / 2);
      if (isPast) {
        gradient.addColorStop(0, '#38bdf8');
        gradient.addColorStop(0.5, '#06b6d4');
        gradient.addColorStop(1, '#0284c7');
      } else {
        gradient.addColorStop(0, '#64748b');
        gradient.addColorStop(0.5, '#334155');
        gradient.addColorStop(1, '#1e293b');
      }

      ctx.fillStyle = gradient;
      ctx.fillRect(x + 0.5, halfH - barH / 2, Math.max(1, barWidth - 1), barH);
    });

    // Dimming overlays & Cut Region Markers
    if (cutStart !== null && cutEnd !== null && cutEnd > cutStart) {
      const startX = (cutStart / duration) * width;
      const endX = (cutEnd / duration) * width;

      // Dim outer areas (to clearly show what will be cut out)
      ctx.fillStyle = 'rgba(2, 6, 23, 0.7)';
      ctx.fillRect(0, 0, startX, height);
      ctx.fillRect(endX, 0, width - endX, height);

      // Highlight selected slice
      ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
      ctx.fillRect(startX, 0, endX - startX, height);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
      ctx.strokeRect(startX, 0, endX - startX, height);

      // Centered Floating Badge between cut points
      const centerBadgeX = (startX + endX) / 2;
      const sliceDuration = (cutEnd - cutStart).toFixed(2);
      const centerLabel = `✂ Selected Slice: ${sliceDuration}s`;
      ctx.font = 'bold 10px monospace';
      const labelW = ctx.measureText(centerLabel).width + 16;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(centerBadgeX - labelW / 2, 8, labelW, 18, 9);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(centerLabel, centerBadgeX - labelW / 2 + 8, 21);
    }

    // Cut Start Line & Floating Badge
    if (cutStart !== null) {
      const csX = (cutStart / duration) * width;

      // Vertical line
      ctx.strokeStyle = '#f59e0b'; // Amber
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(csX, 0);
      ctx.lineTo(csX, height);
      ctx.stroke();
      ctx.setLineDash([]);

      // Floating Badge above the line
      const badgeText = `✂ Start: ${cutStart.toFixed(2)}s`;
      ctx.font = 'bold 9px monospace';
      const badgeW = ctx.measureText(badgeText).width + 12;
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.roundRect(Math.max(4, Math.min(width - badgeW - 4, csX - badgeW / 2)), 28, badgeW, 16, 8);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.fillText(badgeText, Math.max(4, Math.min(width - badgeW - 4, csX - badgeW / 2)) + 6, 40);
    }

    // Cut End Line & Floating Badge
    if (cutEnd !== null) {
      const ceX = (cutEnd / duration) * width;

      // Vertical line
      ctx.strokeStyle = '#10b981'; // Emerald
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ceX, 0);
      ctx.lineTo(ceX, height);
      ctx.stroke();
      ctx.setLineDash([]);

      // Floating Badge above the line
      const badgeText = `✂ End: ${cutEnd.toFixed(2)}s`;
      ctx.font = 'bold 9px monospace';
      const badgeW = ctx.measureText(badgeText).width + 12;
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.roundRect(Math.max(4, Math.min(width - badgeW - 4, ceX - badgeW / 2)), 28, badgeW, 16, 8);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.fillText(badgeText, Math.max(4, Math.min(width - badgeW - 4, ceX - badgeW / 2)) + 6, 40);
    }

    // Playhead cursor
    const cursorX = (currentTime / duration) * width;
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, height);
    ctx.stroke();

    // Playhead glowing cap
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(cursorX, 6, 4, 0, Math.PI * 2);
    ctx.fill();
  }, [activeAudio, currentTime, isRangeActive, rangeStart, rangeEnd, cutStart, cutEnd]);

  // Click & Seek on Waveform
  const handleWaveformClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !activeAudio || !audioRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = ratio * activeAudio.duration;

    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);

    // If currently setting cut start or end, update click point
    if (cutStep === 'start-set' && cutStart === null) {
      setCutStart(Math.round(newTime * 100) / 100);
    } else if (cutStep === 'start-set' && cutStart !== null && cutEnd === null) {
      // User clicked again: can set end
      const start = Math.min(cutStart, Math.round(newTime * 100) / 100);
      const end = Math.max(cutStart, Math.round(newTime * 100) / 100);
      setCutStart(start);
      setCutEnd(end);
      setCutStep('end-set');
    }
  };

  // Cut Button Multi-Step Click Handler
  const handleCutButtonClick = () => {
    if (!activeAudio) return;

    if (cutStep === 'idle') {
      // 1st click: Mark start cut point at current playback time
      const start = Math.round(currentTime * 100) / 100;
      setCutStart(start);
      setCutEnd(null);
      setCutStep('start-set');
    } else if (cutStep === 'start-set') {
      // 2nd click: Mark end cut point at current playback time
      let end = Math.round(currentTime * 100) / 100;
      let start = cutStart ?? 0;
      if (end <= start) {
        // If playhead hasn't moved or is behind, set end to start + 3s or duration
        end = Math.min(activeAudio.duration, start + 3.0);
      }
      setCutStart(Math.min(start, end));
      setCutEnd(Math.max(start, end));
      setCutStep('end-set');
    }
  };

  // Reset Cut Selection
  const handleCancelCut = () => {
    setCutStep('idle');
    setCutStart(null);
    setCutEnd(null);
  };

  // Apply Cut (Trim Audio)
  const handleApplyCut = async () => {
    if (!activeAudio || cutStart === null || cutEnd === null) return;
    setIsTrimming(true);
    try {
      const trimmed = await trimAudio(activeAudio.id, cutStart, cutEnd);
      onAudioSelected(trimmed);
      setProcessedAudio(trimmed);
      setActiveVersion('processed');
      setTrimNotice(`Track trimmed successfully to ${cutStart.toFixed(2)}s - ${cutEnd.toFixed(2)}s (${trimmed.duration.toFixed(2)}s)`);
      setCutStep('idle');
      setCutStart(null);
      setCutEnd(null);
      setTimeout(() => setTrimNotice(null), 5000);
    } catch (err: any) {
      alert(`Trimming error: ${err.message}`);
    } finally {
      setIsTrimming(false);
    }
  };

  const handleTogglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      if (isRangeActive && (audio.currentTime < rangeStart || audio.currentTime >= rangeEnd)) {
        audio.currentTime = rangeStart;
      }
      audio.playbackRate = playbackRate;
      audio.preservesPitch = true;
      audio.play().then(() => setIsPlaying(true)).catch(console.error);
    }
  };

  const handleStop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = isRangeActive ? rangeStart : 0;
    setCurrentTime(audio.currentTime);
    setIsPlaying(false);
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
      audioRef.current.preservesPitch = true;
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    try {
      const info = await uploadAudio(file);
      onAudioSelected(info);
      setProcessedAudio(null);
      setActiveVersion('original');
    } catch (err: any) {
      alert(`Upload error: ${err.message}`);
    }
  };

  const handleApplyDsp = async () => {
    if (!audioInfo) return;
    setIsProcessingDsp(true);
    try {
      const opts: PreprocessOptions = {
        noise_reduction_enabled: noiseReduction,
        noise_reduction_intensity: noiseIntensity,
        normalize_enabled: normalize,
        time_range_start: isRangeActive ? rangeStart : undefined,
        time_range_end: isRangeActive ? rangeEnd : undefined,
      };
      const result = await preprocessAudio(audioInfo.id, opts);
      setProcessedAudio(result);
      setActiveVersion('processed');
    } catch (err: any) {
      alert(`Processing error: ${err.message}`);
    } finally {
      setIsProcessingDsp(false);
    }
  };

  const handleRunTranscription = async () => {
    if (!activeAudio) return;
    setIsTranscribing(true);
    try {
      const trans = await transcribeAudio(activeAudio.id);
      onTranscriptionComplete(trans);
    } catch (err: any) {
      alert(`Transcription error: ${err.message}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Audio Element */}
      {activeAudio && (
        <audio
          ref={audioRef}
          src={getAudioFileUrl(activeAudio.id)}
          preload="auto"
        />
      )}

      {/* Notification Banner when trimmed */}
      {trimNotice && (
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-600/70 text-emerald-300 text-xs font-semibold shadow-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{trimNotice}</span>
          </div>
          <button onClick={() => setTrimNotice(null)} className="text-emerald-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Main Waveform & Transport Deck */}
      <div className="daw-panel p-6 border border-slate-800/80 bg-slate-900/60 shadow-xl rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-950/60 border border-cyan-800/50 text-cyan-400">
              <FileAudio className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                {activeAudio ? activeAudio.original_filename : 'No Audio Loaded'}
                {activeVersion === 'processed' && (
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700/60 text-emerald-400 font-mono">
                    Cleaned / Cut Audio
                  </span>
                )}
              </h2>
              <div className="text-xs text-slate-400 flex items-center gap-3 mt-0.5">
                {activeAudio ? (
                  <>
                    <span>{(activeAudio.file_size / (1024 * 1024)).toFixed(2)} MB</span>
                    <span>•</span>
                    <span>{activeAudio.format.toUpperCase()}</span>
                    <span>•</span>
                    <span>{activeAudio.sample_rate} Hz</span>
                    <span>•</span>
                    <span>{activeAudio.channels === 1 ? 'Mono' : 'Stereo'}</span>
                  </>
                ) : (
                  <span>Upload a WAV, MP3, FLAC, or OGG file to begin</span>
                )}
              </div>
            </div>
          </div>

          {/* A/B Switcher if processed version exists */}
          {processedAudio && (
            <div className="flex items-center gap-2 bg-slate-950/90 border border-slate-800 p-1 rounded-xl">
              <button
                onClick={() => {
                  setActiveVersion('original');
                  setIsPlaying(false);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  activeVersion === 'original'
                    ? 'bg-slate-800 text-cyan-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Original Audio
              </button>
              <button
                onClick={() => {
                  setActiveVersion('processed');
                  setIsPlaying(false);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  activeVersion === 'processed'
                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-700/50'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Processed Track
              </button>
            </div>
          )}

          {/* Upload Button */}
          <label className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-slate-800/80 hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-700/60 rounded-xl text-xs font-semibold transition-all shadow-sm">
            <Upload className="w-3.5 h-3.5" />
            <span>Select Audio File</span>
            <input
              type="file"
              accept=".wav,.mp3,.flac,.ogg"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        {/* Waveform Canvas */}
        <div className="relative rounded-xl overflow-hidden border border-slate-800/90 bg-[#070b12] mb-5">
          <canvas
            ref={canvasRef}
            onClick={handleWaveformClick}
            className="w-full h-36 cursor-crosshair block"
          />
          {!activeAudio && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 gap-2 bg-slate-950/80 backdrop-blur-xs">
              <Upload className="w-8 h-8 text-slate-600 animate-bounce" />
              <p className="text-sm font-medium">Drag & Drop or Choose an Audio File</p>
              <p className="text-xs text-slate-600">Supports WAV, MP3, FLAC, and OGG</p>
            </div>
          )}
        </div>

        {/* Transport & Cut Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800/60">
          {/* Playback Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleTogglePlay}
              disabled={!activeAudio}
              className={`p-3 rounded-xl transition-all shadow-md flex items-center justify-center ${
                isPlaying
                  ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-amber-500/20'
                  : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-500/20'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            <button
              onClick={handleStop}
              disabled={!activeAudio}
              className="p-3 rounded-xl bg-slate-800/80 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700/60 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title="Stop"
            >
              <Square className="w-4 h-4" />
            </button>

            {/* Time Display */}
            <div className="ml-3 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800/80 font-mono text-sm tracking-wider text-cyan-400 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>{currentTime.toFixed(2)}s</span>
              <span className="text-slate-600">/</span>
              <span className="text-slate-400">{(activeAudio?.duration || 0).toFixed(2)}s</span>
            </div>
          </div>

          {/* Cut Tool Section (Multi-Click Cut & Trim Workflow) */}
          <div className="flex items-center gap-2 bg-slate-950/90 border border-slate-800 p-1.5 rounded-xl">
            {cutStep !== 'end-set' ? (
              <button
                onClick={handleCutButtonClick}
                disabled={!activeAudio}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  cutStep === 'idle'
                    ? 'bg-slate-800 text-amber-300 hover:bg-amber-950/50 hover:text-amber-200 border border-amber-800/50'
                    : 'bg-amber-500 text-slate-950 animate-pulse font-bold'
                }`}
                title="1st click: Set Cut Start • 2nd click: Set Cut End"
              >
                <Scissors className="w-3.5 h-3.5" />
                {cutStep === 'idle' ? '✂ Set Cut Start' : '✂ Set Cut End'}
              </button>
            ) : (
              /* Phase 2: Apply Cut & Cancel */
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleApplyCut}
                  disabled={isTrimming}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-all shadow-md"
                >
                  {isTrimming ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  {isTrimming ? 'Trimming...' : '✓ Apply Cut'}
                </button>
                <button
                  onClick={handleCancelCut}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
                  title="Cancel cut"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Cut Indicators */}
            {cutStart !== null && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-amber-300">
                Start: {cutStart.toFixed(2)}s
              </span>
            )}
            {cutEnd !== null && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-emerald-300">
                End: {cutEnd.toFixed(2)}s
              </span>
            )}
          </div>

          {/* Speed & Loop Controls */}
          <div className="flex items-center gap-3">
            {/* Speed Presets */}
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-xl">
              {[0.5, 0.75, 1.0].map((rate) => (
                <button
                  key={rate}
                  onClick={() => handleRateChange(rate)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                    playbackRate === rate
                      ? 'bg-cyan-950 border border-cyan-700/60 text-cyan-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {rate * 100}%
                </button>
              ))}
            </div>

            {/* Loop Toggle */}
            <button
              onClick={() => setIsLooping(!isLooping)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
                isLooping
                  ? 'bg-indigo-950 border-indigo-700/60 text-indigo-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <RefreshCw className={`w-3 h-3 ${isLooping ? 'animate-spin' : ''}`} />
              Loop
            </button>
          </div>

          {/* Run Transcription CTA */}
          <button
            onClick={handleRunTranscription}
            disabled={!activeAudio || isTranscribing}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-semibold rounded-xl text-sm shadow-lg shadow-cyan-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles className={`w-4 h-4 ${isTranscribing ? 'animate-spin' : ''}`} />
            {isTranscribing ? 'Analyzing Audio...' : 'Run Music Transcription'}
          </button>
        </div>
      </div>

      {/* DSP Preprocessing Studio Panel */}
      <div className="daw-panel p-6 border border-slate-800/80 bg-slate-900/40 rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-slate-200">Audio Preprocessing & Restoration (DSP)</h3>
          </div>
          <span className="text-xs text-slate-400">Modular DSP Pipeline</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Noise Reduction */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">Stationary Noise Reduction</span>
              <input
                type="checkbox"
                checked={noiseReduction}
                onChange={(e) => setNoiseReduction(e.target.checked)}
                className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
              />
            </div>
            <p className="text-xs text-slate-400">
              Reduces stationary HVAC, mic hiss, and hum without destroying musical harmonics.
            </p>
            {noiseReduction && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Intensity</span>
                  <span>{Math.round(noiseIntensity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  value={noiseIntensity}
                  onChange={(e) => setNoiseIntensity(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400"
                />
              </div>
            )}
          </div>

          {/* Normalization */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">Peak & Loudness Normalization</span>
              <input
                type="checkbox"
                checked={normalize}
                onChange={(e) => setNormalize(e.target.checked)}
                className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
              />
            </div>
            <p className="text-xs text-slate-400">
              Levels audio to -1.0 dBFS for consistent transcription detection thresholds.
            </p>
          </div>

          {/* Action Card */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col justify-between">
            <div>
              <span className="text-sm font-medium text-slate-300">Process Audio Copy</span>
              <p className="text-xs text-slate-400 mt-1">
                Preserves original audio intact and generates a separate cleaned track.
              </p>
            </div>
            <button
              onClick={handleApplyDsp}
              disabled={!audioInfo || isProcessingDsp}
              className="mt-3 w-full py-2 bg-slate-800 hover:bg-slate-750 text-cyan-300 border border-cyan-800/50 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-40"
            >
              {isProcessingDsp ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Applying DSP...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Apply Preprocessing
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
