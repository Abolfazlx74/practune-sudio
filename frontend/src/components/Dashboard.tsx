import React, { useEffect, useState } from 'react';
import {
  Upload,
  Music,
  Clock,
  Sparkles,
  ArrowRight,
  FolderOpen,
  FileAudio,
  ChevronRight,
} from 'lucide-react';
import type { AudioInfo, Project } from '../types';
import { listRecentAudios, uploadAudio } from '../services/api';
import {
  getAllProjects,
  generateAssetId,
  storeAudioBlob,
} from '../services/projectService';

interface DashboardProps {
  onSelectAudio: (audio: AudioInfo, file?: File) => void;
  onOpenProject: (project: Project) => void;
  onOpenHistory: () => void;
  onNavigateToWorkspace: () => void;
  isDirty?: boolean;
  onRequestImportWithCheck?: (importFn: () => Promise<void>) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  onSelectAudio,
  onOpenProject,
  onOpenHistory,
  onNavigateToWorkspace,
  isDirty = false,
  onRequestImportWithCheck,
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentAudios, setRecentAudios] = useState<AudioInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [savedProjects, audios] = await Promise.all([
          getAllProjects(),
          listRecentAudios().catch(() => []),
        ]);
        setProjects(savedProjects);
        setRecentAudios(audios);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      triggerAudioImport(files[0]);
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      triggerAudioImport(files[0]);
    }
  };

  const triggerAudioImport = (file: File) => {
    const doImport = async () => {
      try {
        const info = await uploadAudio(file);
        const assetId = generateAssetId(file.name, file.size);
        await storeAudioBlob(assetId, file, {
          filename: file.name,
          mimeType: file.type || 'audio/wav',
        });
        onSelectAudio(info, file);
        onNavigateToWorkspace();
      } catch (err: any) {
        alert(`Upload error: ${err.message}`);
      }
    };

    if (isDirty && onRequestImportWithCheck) {
      onRequestImportWithCheck(doImport);
    } else {
      doImport();
    }
  };

  // Demo audio synthesizer generator for instant testing
  const handleLoadDemo = () => {
    const doLoadDemo = async () => {
      const sampleRate = 22050;
      const notes = [60, 64, 67, 72, 67, 64, 60]; // C4, E4, G4, C5, G4, E4, C4
      const noteDuration = 0.45;
      const totalSamples = Math.floor(sampleRate * notes.length * noteDuration);
      const buffer = new Float32Array(totalSamples);

      notes.forEach((midi, idx) => {
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const startSample = Math.floor(idx * noteDuration * sampleRate);
        const endSample = startSample + Math.floor(noteDuration * sampleRate);
        for (let s = startSample; s < endSample; s++) {
          const t = (s - startSample) / sampleRate;
          const vibrato = 2.5 * Math.sin(2 * Math.PI * 5 * t);
          const val =
            0.6 * Math.sin(2 * Math.PI * (freq + vibrato) * t) +
            0.3 * Math.sin(2 * Math.PI * (freq * 2) * t);
          const env = Math.sin((Math.PI * (s - startSample)) / (endSample - startSample));
          buffer[s] = val * env;
        }
      });

      const wavBytes = encodeWAV(buffer, sampleRate);
      const file = new File([wavBytes], 'vocal_arpeggio_demo.wav', { type: 'audio/wav' });
      const info = await uploadAudio(file);
      const assetId = generateAssetId(file.name, file.size);
      await storeAudioBlob(assetId, file, { filename: file.name, mimeType: 'audio/wav' });
      onSelectAudio(info, file);
      onNavigateToWorkspace();
    };

    if (isDirty && onRequestImportWithCheck) {
      onRequestImportWithCheck(doLoadDemo);
    } else {
      doLoadDemo();
    }
  };

  // Build top 3 items for display (Projects prioritized, fallback to raw audios)
  const displayItems =
    projects.length > 0
      ? projects.slice(0, 3).map((p) => ({
          id: p.id,
          name: p.name,
          duration: p.audioInfo.duration,
          format: p.audioInfo.format,
          latestScore:
            p.configurations && p.configurations.length > 0
              ? p.configurations[0].latest_score
              : null,
          isProject: true,
          project: p,
        }))
      : recentAudios.slice(0, 3).map((a) => ({
          id: a.id,
          name: a.original_filename,
          duration: a.duration,
          format: a.format,
          latestScore: null,
          isProject: false,
          audio: a,
        }));

  const totalCount = projects.length > 0 ? projects.length : recentAudios.length;

  return (
    <div className="space-y-8 max-w-6xl mx-auto py-2">
      {/* Hero Welcome Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-cyan-950/40 border border-slate-800/80 p-8 shadow-2xl">
        <div className="max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/70 border border-cyan-700/60 text-cyan-300 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            Next-Gen Music Learning & Pitch Intelligence
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight leading-tight">
            Transcribe, Visualize, and Master Every Note.
          </h1>
          <p className="text-slate-300 text-sm leading-relaxed">
            Upload vocal or instrument audio to extract pitch contours, edit note matrices with NewTone-style smoothing, and sing along with real-time pitch feedback.
          </p>
          <div className="pt-2 flex flex-wrap items-center gap-3">
            <label className="cursor-pointer flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold rounded-xl text-xs shadow-lg shadow-cyan-500/25 transition-all">
              <Upload className="w-4 h-4" />
              Upload Audio File
              <input
                type="file"
                accept=".wav,.mp3,.flac,.ogg"
                onChange={handleFileInput}
                className="hidden"
              />
            </label>

            <button
              onClick={handleLoadDemo}
              className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700/80 font-semibold rounded-xl text-xs transition-all shadow-sm"
            >
              <Music className="w-4 h-4 text-cyan-400" />
              Load Vocal Arpeggio Demo
            </button>
          </div>
        </div>
      </div>

      {/* Drag & Drop Upload Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`daw-panel p-10 border-2 border-dashed rounded-3xl text-center transition-all ${
          isDragging
            ? 'border-cyan-400 bg-cyan-950/20'
            : 'border-slate-800 hover:border-slate-700 bg-slate-900/30'
        }`}
      >
        <div className="flex flex-col items-center justify-center gap-3">
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-cyan-400">
            <Upload className="w-8 h-8" />
          </div>
          <div>
            <p className="text-base font-semibold text-white">Drag & drop your audio track here</p>
            <p className="text-xs text-slate-400 mt-1">Supports WAV, MP3, FLAC, and OGG formats</p>
          </div>
        </div>
      </div>

      {/* Recent Projects & Uploads (Preserves section design, max 3, More action, overflow fix) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-cyan-400" />
            <h2 className="text-base font-semibold text-slate-200">Recent Studio Sessions</h2>
          </div>

          <button
            onClick={onOpenHistory}
            className="text-xs text-slate-400 hover:text-cyan-400 font-mono transition-colors flex items-center gap-1 cursor-pointer bg-transparent border-0"
            title="Open complete project library in History"
          >
            <span>More</span>
            <span>({totalCount})</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading sessions...</div>
        ) : displayItems.length === 0 ? (
          <div className="p-8 rounded-2xl bg-slate-900/30 border border-slate-800/80 text-center text-slate-400 text-xs">
            No audio sessions found. Upload a track or click "Load Vocal Arpeggio Demo" above!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayItems.map((item: any) => (
              <div
                key={item.id}
                onClick={() => {
                  if (item.isProject && item.project) {
                    onOpenProject(item.project);
                  } else if (item.audio) {
                    onSelectAudio(item.audio);
                    onNavigateToWorkspace();
                  }
                }}
                className="daw-panel p-4 border border-slate-800/80 bg-slate-900/40 hover:bg-slate-900/80 hover:border-cyan-800/60 rounded-2xl cursor-pointer transition-all group shadow-sm overflow-hidden"
              >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-cyan-400 group-hover:bg-cyan-950 transition-colors shrink-0">
                      <FileAudio className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <h3
                        className="text-xs font-semibold text-slate-200 group-hover:text-cyan-300 transition-colors truncate block w-full text-ellipsis overflow-hidden"
                        title={item.name}
                      >
                        {item.name}
                      </h3>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                        <span className="flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3" />
                          {item.duration.toFixed(1)}s
                        </span>
                        <span>•</span>
                        <span className="uppercase font-mono">{item.format}</span>
                        {item.latestScore !== null && (
                          <>
                            <span>•</span>
                            <span className="text-cyan-400 font-mono font-semibold">
                              {item.latestScore}%
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Helper: encode Float32Array to 16-bit WAV PCM ArrayBuffer
function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
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
