import React, { useState, useEffect, useRef } from 'react';
import {
  History,
  X,
  Trash2,
  Play,
  Award,
  TrendingUp,
  Clock,
  Music,
  Target,
  FileQuestion,
  Upload,
  CheckCircle,
  AlertTriangle,
  ChevronRight,
  Layers,
  Calendar,
} from 'lucide-react';
import type {
  AudioInfo,
  HistoryTrack,
  PerformanceRecord,
  PracticeConfigSettings,
  PracticeConfiguration,
  TranscriptionResult,
} from '../types';
import {
  getHistory,
  deleteTrack,
  deleteConfiguration,
  deleteSessionRecord,
  clearAllHistory,
  relinkTrackId,
} from '../services/historyService';
import { getAudioInfo, getTranscription, uploadAudio } from '../services/api';

interface SmartHistoryModalProps {
  currentAudioId: string;
  onClose: () => void;
  onRestore: (
    audio: AudioInfo,
    transcription: TranscriptionResult,
    settings: PracticeConfigSettings
  ) => void;
  onApplySettingsOnly: (settings: PracticeConfigSettings) => void;
}

export const SmartHistoryModal: React.FC<SmartHistoryModalProps> = ({
  currentAudioId,
  onClose,
  onRestore,
  onApplySettingsOnly,
}) => {
  const [history, setHistory] = useState<HistoryTrack[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string>('');
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [activeSessionHover, setActiveSessionHover] = useState<PerformanceRecord | null>(null);

  // File status & re-upload state
  const [fileCheckStatus, setFileCheckStatus] = useState<'checking' | 'exists' | 'missing' | 'idle'>('idle');
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [isReuploading, setIsReuploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load history from storage on mount
  useEffect(() => {
    const loaded = getHistory();
    setHistory(loaded);

    if (loaded.length > 0) {
      // Default to current track if exists, otherwise first track
      const matchingTrack = loaded.find((t) => t.track_id === currentAudioId) || loaded[0];
      setSelectedTrackId(matchingTrack.track_id);
      if (matchingTrack.configurations.length > 0) {
        setSelectedConfigId(matchingTrack.configurations[0].config_id);
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentAudioId, onClose]);

  const selectedTrack = history.find((t) => t.track_id === selectedTrackId);
  const selectedConfig = selectedTrack?.configurations.find(
    (c) => c.config_id === selectedConfigId
  ) || selectedTrack?.configurations[0];

  // Verify file existence on disk whenever selected track changes
  useEffect(() => {
    if (!selectedTrack) {
      setFileCheckStatus('idle');
      return;
    }

    let isMounted = true;
    setFileCheckStatus('checking');
    setRestoreError(null);

    getAudioInfo(selectedTrack.track_id)
      .then(() => {
        if (isMounted) setFileCheckStatus('exists');
      })
      .catch(() => {
        if (isMounted) setFileCheckStatus('missing');
      });

    return () => {
      isMounted = false;
    };
  }, [selectedTrack?.track_id]);

  // When track selection changes, update selected config
  const handleSelectTrack = (track: HistoryTrack) => {
    setSelectedTrackId(track.track_id);
    if (track.configurations.length > 0) {
      setSelectedConfigId(track.configurations[0].config_id);
    } else {
      setSelectedConfigId('');
    }
  };

  // Delete Handlers
  const handleDeleteTrack = (trackId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this track and all its practice history?')) return;
    const updated = deleteTrack(trackId);
    setHistory(updated);
    if (selectedTrackId === trackId) {
      if (updated.length > 0) {
        handleSelectTrack(updated[0]);
      } else {
        setSelectedTrackId('');
        setSelectedConfigId('');
      }
    }
  };

  const handleDeleteConfig = (configId: string) => {
    if (!selectedTrack) return;
    if (!confirm('Delete this practice configuration and all its session records?')) return;
    const updated = deleteConfiguration(selectedTrack.track_id, configId);
    setHistory(updated);
    const refreshedTrack = updated.find((t) => t.track_id === selectedTrack.track_id);
    if (refreshedTrack && refreshedTrack.configurations.length > 0) {
      setSelectedConfigId(refreshedTrack.configurations[0].config_id);
    } else if (updated.length > 0) {
      handleSelectTrack(updated[0]);
    } else {
      setSelectedTrackId('');
      setSelectedConfigId('');
    }
  };

  const handleDeleteSession = (recordId: string) => {
    if (!selectedTrack || !selectedConfig) return;
    const updated = deleteSessionRecord(selectedTrack.track_id, selectedConfig.config_id, recordId);
    setHistory(updated);
  };

  const handleClearAll = () => {
    if (!confirm('Are you sure you want to clear ALL practice history? This action cannot be undone.')) return;
    clearAllHistory();
    setHistory([]);
    setSelectedTrackId('');
    setSelectedConfigId('');
  };

  // Restore track and configuration
  const handleRestoreTrack = async () => {
    if (!selectedTrack || !selectedConfig) return;

    // If it's already the current active track, apply settings directly
    if (selectedTrack.track_id === currentAudioId) {
      onApplySettingsOnly(selectedConfig.settings);
      onClose();
      return;
    }

    setIsRestoring(true);
    setRestoreError(null);

    try {
      const audio = await getAudioInfo(selectedTrack.track_id);
      const transcription = await getTranscription(selectedTrack.track_id);
      onRestore(audio, transcription, selectedConfig.settings);
      onClose();
    } catch (err: any) {
      setRestoreError(
        `Track Not Found: The audio file for "${selectedTrack.filename}" could not be located on disk.`
      );
      setFileCheckStatus('missing');
    } finally {
      setIsRestoring(false);
    }
  };

  // Handle re-uploading / locating a missing file
  const handleFileReupload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedTrack) return;

    setIsReuploading(true);
    setRestoreError(null);

    try {
      const newAudio = await uploadAudio(file);
      const transcription = await getTranscription(newAudio.id);
      const updated = relinkTrackId(selectedTrack.track_id, newAudio);
      setHistory(updated);
      setSelectedTrackId(newAudio.id);
      setFileCheckStatus('exists');

      if (selectedConfig) {
        onRestore(newAudio, transcription, selectedConfig.settings);
        onClose();
      }
    } catch (err: any) {
      setRestoreError(`Failed to restore audio: ${err.message || 'Upload error'}`);
    } finally {
      setIsReuploading(false);
    }
  };

  const scoreDelta =
    selectedConfig && selectedConfig.sessions.length > 1
      ? selectedConfig.latest_score - selectedConfig.first_score
      : 0;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-container max-w-5xl h-[88vh]">
        {/* Pinned Header */}
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-800/60 text-cyan-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Smart Performance History</h2>
              <p className="text-xs text-slate-400">Track library, configurations, and progress analytics</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl bg-slate-800 hover:bg-slate-700 transition-colors"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body: 2-Column Library & Analytics Layout */}
        <div className="modal-body p-0 flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-800 overflow-hidden">
          {/* Left Column: Track Library */}
          <div className="w-full md:w-80 flex flex-col bg-slate-950/60 shrink-0 overflow-y-auto">
            <div className="p-3 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Music className="w-3.5 h-3.5 text-cyan-400" />
                Track Library ({history.length})
              </span>
              {history.length > 0 && (
                <button
                  onClick={handleClearAll}
                  className="text-[11px] text-rose-400 hover:text-rose-300 font-semibold bg-transparent hover:bg-rose-950/40 px-2 py-1 rounded-lg border-0 transition-colors cursor-pointer"
                  title="Clear all history"
                >
                  Clear All
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="p-8 text-center text-slate-500 space-y-2">
                <History className="w-8 h-8 mx-auto opacity-30" />
                <p className="text-xs">No practice history recorded yet.</p>
                <p className="text-[11px] text-slate-600">Complete a practice session to start tracking your vocal progress.</p>
              </div>
            ) : (
              <div className="p-2 space-y-1.5 overflow-y-auto">
                {history.map((track) => {
                  const isSelected = track.track_id === selectedTrackId;
                  const totalSessions = track.configurations.reduce(
                    (acc, c) => acc + c.sessions.length,
                    0
                  );
                  const latestScore =
                    track.configurations[0]?.latest_score !== undefined
                      ? track.configurations[0].latest_score
                      : null;

                  return (
                    <div
                      key={track.track_id}
                      onClick={() => handleSelectTrack(track)}
                      className={`group p-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-slate-900 border-cyan-500/50 shadow-md shadow-cyan-950/30'
                          : 'bg-slate-950/80 border-slate-800/80 hover:bg-slate-900/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs font-bold text-white truncate" title={track.filename}>
                            {track.filename}
                          </h4>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                            <span>{track.duration.toFixed(1)}s</span>
                            <span>•</span>
                            <span>{track.configurations.length} config{track.configurations.length > 1 ? 's' : ''}</span>
                            <span>•</span>
                            <span>{totalSessions} session{totalSessions > 1 ? 's' : ''}</span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          {latestScore !== null && (
                            <span className="px-2 py-0.5 rounded-lg bg-cyan-950 border border-cyan-800/60 font-mono text-xs font-bold text-cyan-400">
                              {latestScore}%
                            </span>
                          )}
                          <button
                            onClick={(e) => handleDeleteTrack(track.track_id, e)}
                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-1.5 rounded-lg bg-transparent hover:bg-rose-950/50 transition-all border-0 flex items-center justify-center cursor-pointer"
                            title="Delete Track History"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Analytics, Progress Charts & Restoration */}
          <div className="flex-1 p-5 overflow-y-auto space-y-5">
            {!selectedTrack ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                <Music className="w-10 h-10 opacity-30" />
                <p className="text-sm">Select a track from the library to view performance analytics.</p>
              </div>
            ) : (
              <>
                {/* Track Details & Restoration Header */}
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white">{selectedTrack.filename}</h3>
                      {selectedTrack.track_id === currentAudioId && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-400">
                          ACTIVE IN STUDIO
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-400">
                      <span>Duration: {selectedTrack.duration.toFixed(1)}s</span>
                      <span>•</span>
                      <span>Last Practiced: {new Date(selectedTrack.last_practiced_at).toLocaleDateString()}</span>
                      <span>•</span>
                      {fileCheckStatus === 'exists' && (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> File Ready
                        </span>
                      )}
                      {fileCheckStatus === 'missing' && (
                        <span className="text-rose-400 flex items-center gap-1 font-semibold">
                          <FileQuestion className="w-3.5 h-3.5" /> File Not Found on Disk
                        </span>
                      )}
                      {fileCheckStatus === 'checking' && (
                        <span className="text-slate-500 animate-pulse">Checking file status...</span>
                      )}
                    </div>
                  </div>

                  {/* Restore / Re-upload Actions */}
                  <div className="flex items-center gap-2">
                    {fileCheckStatus === 'missing' ? (
                      <label className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-md">
                        <Upload className="w-3.5 h-3.5" />
                        <span>Locate & Re-upload Audio</span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".wav,.mp3,.flac,.ogg"
                          onChange={handleFileReupload}
                          disabled={isReuploading}
                          className="hidden"
                        />
                      </label>
                    ) : (
                      <button
                        onClick={handleRestoreTrack}
                        disabled={isRestoring || fileCheckStatus !== 'exists'}
                        className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-md shadow-cyan-500/20 disabled:opacity-40"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        {selectedTrack.track_id === currentAudioId
                          ? 'Apply Settings to Studio'
                          : 'Restore Track & Practice'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Error Banner if missing */}
                {restoreError && (
                  <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-xs text-rose-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold">Track Not Found: </strong>
                      <span>{restoreError} Use the "Locate & Re-upload Audio" button to re-link this history record.</span>
                    </div>
                  </div>
                )}

                {/* Practice Configuration Selector Tabs */}
                {selectedTrack.configurations.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-cyan-400" />
                        Practice Configurations ({selectedTrack.configurations.length})
                      </span>
                      {selectedConfig && selectedTrack.configurations.length > 1 && (
                        <button
                          onClick={() => handleDeleteConfig(selectedConfig.config_id)}
                          className="text-[11px] text-slate-500 hover:text-rose-400 transition-colors bg-transparent hover:bg-rose-950/30 px-2 py-0.5 rounded-lg border-0 cursor-pointer"
                        >
                          Delete This Configuration
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {selectedTrack.configurations.map((cfg) => {
                        const isCfgActive = cfg.config_id === selectedConfig?.config_id;
                        return (
                          <button
                            key={cfg.config_id}
                            onClick={() => setSelectedConfigId(cfg.config_id)}
                            className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 border ${
                              isCfgActive
                                ? 'bg-cyan-950/80 border-cyan-600 text-cyan-300 shadow-sm'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                            }`}
                          >
                            {cfg.settings.mode === 'note' ? (
                              <Target className="w-3.5 h-3.5 text-amber-400" />
                            ) : (
                              <Music className="w-3.5 h-3.5 text-cyan-400" />
                            )}
                            <span>{cfg.label}</span>
                            <span className="px-1.5 py-0.5 rounded-full bg-slate-900 text-[10px] font-mono text-slate-400">
                              {cfg.sessions.length}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Performance Analytics & Stats Cards for Selected Configuration */}
                {selectedConfig && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {/* Latest Score */}
                      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-1">
                        <span className="text-[11px] text-slate-400 font-medium">Latest Score</span>
                        <div className="text-2xl font-black font-mono text-cyan-400">
                          {selectedConfig.latest_score}%
                        </div>
                        <span className="text-[10px] text-slate-500">Most recent attempt</span>
                      </div>

                      {/* Best Score */}
                      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-1">
                        <span className="text-[11px] text-slate-400 font-medium">Personal Best</span>
                        <div className="text-2xl font-black font-mono text-emerald-400 flex items-center justify-center gap-1">
                          <Award className="w-4 h-4 text-emerald-400" />
                          {selectedConfig.best_score}%
                        </div>
                        <span className="text-[10px] text-slate-500">All-time record</span>
                      </div>

                      {/* First Score */}
                      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-1">
                        <span className="text-[11px] text-slate-400 font-medium">Initial Score</span>
                        <div className="text-2xl font-black font-mono text-slate-300">
                          {selectedConfig.first_score}%
                        </div>
                        <span className="text-[10px] text-slate-500">Session 1 benchmark</span>
                      </div>

                      {/* Improvement Trend */}
                      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-1">
                        <span className="text-[11px] text-slate-400 font-medium">Progress Trend</span>
                        <div
                          className={`text-2xl font-black font-mono flex items-center justify-center gap-1 ${
                            scoreDelta > 0
                              ? 'text-emerald-400'
                              : scoreDelta < 0
                              ? 'text-rose-400'
                              : 'text-slate-400'
                          }`}
                        >
                          <TrendingUp className="w-4 h-4" />
                          {scoreDelta > 0 ? `+${scoreDelta}%` : `${scoreDelta}%`}
                        </div>
                        <span className="text-[10px] text-slate-500">
                          {selectedConfig.sessions.length} recorded session{selectedConfig.sessions.length > 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>

                    {/* Performance Progress Chart */}
                    <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-cyan-400" />
                          <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                            Score Trend Chart over Sessions
                          </h4>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-400">
                          <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span> Overall Match
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span> Pitch Acc
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span> Timing Acc
                          </span>
                        </div>
                      </div>

                      <div className="h-44 w-full relative">
                        <PerformanceChart
                          sessions={selectedConfig.sessions}
                          onHoverSession={(s) => setActiveSessionHover(s)}
                        />
                      </div>

                      {activeSessionHover && (
                        <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-xs flex items-center justify-between text-slate-300 font-mono animate-fade-in">
                          <span>
                            Session: {new Date(activeSessionHover.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="text-cyan-400 font-bold">
                            Overall: {activeSessionHover.overall_score}%
                          </span>
                          <span className="text-emerald-400">
                            Pitch: {activeSessionHover.pitch_accuracy}%
                          </span>
                          <span className="text-amber-400">
                            Timing: {activeSessionHover.timing_accuracy}%
                          </span>
                          <span>Hit: {activeSessionHover.hit_count}/{activeSessionHover.total_notes}</span>
                        </div>
                      )}
                    </div>

                    {/* Granular Session History Table */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        Practice Session Records ({selectedConfig.sessions.length})
                      </h4>
                      <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                        <table className="eval-table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Date & Time</th>
                              <th>Overall</th>
                              <th>Pitch Acc</th>
                              <th>Timing Acc</th>
                              <th>Notes Hit</th>
                              <th className="text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedConfig.sessions
                              .slice()
                              .reverse()
                              .map((sess, idx) => (
                                <tr key={sess.id}>
                                  <td className="text-slate-500 font-bold">
                                    {selectedConfig.sessions.length - idx}
                                  </td>
                                  <td className="text-slate-300">
                                    {new Date(sess.timestamp).toLocaleString([], {
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </td>
                                  <td className="font-bold text-cyan-400">{sess.overall_score}%</td>
                                  <td className="text-emerald-400">{sess.pitch_accuracy}%</td>
                                  <td className="text-amber-400">{sess.timing_accuracy}%</td>
                                  <td className="text-slate-400">
                                    {sess.hit_count} / {sess.total_notes}
                                  </td>
                                  <td className="text-right">
                                    <button
                                      onClick={() => handleDeleteSession(sess.id)}
                                      className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg bg-transparent hover:bg-rose-950/50 transition-colors border-0 inline-flex items-center justify-center cursor-pointer"
                                      title="Delete this record"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Pinned Footer */}
        <div className="modal-footer">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Interactive SVG Performance Progress Chart
 */
const PerformanceChart: React.FC<{
  sessions: PerformanceRecord[];
  onHoverSession: (s: PerformanceRecord | null) => void;
}> = ({ sessions, onHoverSession }) => {
  const chartRef = useRef<SVGSVGElement | null>(null);

  if (sessions.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-slate-500">
        No sessions to chart yet.
      </div>
    );
  }

  const w = 680;
  const h = 160;
  const paddingX = 40;
  const paddingY = 20;

  const pointsCount = sessions.length;
  const getX = (i: number) =>
    pointsCount <= 1
      ? w / 2
      : paddingX + (i / (pointsCount - 1)) * (w - 2 * paddingX);
  const getY = (val: number) =>
    h - paddingY - (Math.max(0, Math.min(100, val)) / 100) * (h - 2 * paddingY);

  const overallPoints = sessions.map((s, i) => `${getX(i)},${getY(s.overall_score)}`).join(' ');
  const pitchPoints = sessions.map((s, i) => `${getX(i)},${getY(s.pitch_accuracy)}`).join(' ');
  const timingPoints = sessions.map((s, i) => `${getX(i)},${getY(s.timing_accuracy)}`).join(' ');

  return (
    <svg
      ref={chartRef}
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-full select-none"
      onMouseLeave={() => onHoverSession(null)}
    >
      {/* Horizontal Grid Lines */}
      {[0, 25, 50, 75, 100].map((val) => {
        const y = getY(val);
        return (
          <g key={val}>
            <line
              x1={paddingX}
              y1={y}
              x2={w - paddingX}
              y2={y}
              stroke="#1e293b"
              strokeDasharray={val === 50 || val === 100 ? '0' : '2,2'}
            />
            <text x={paddingX - 8} y={y + 3} fill="#475569" fontSize="9" textAnchor="end" fontFamily="monospace">
              {val}%
            </text>
          </g>
        );
      })}

      {/* Timing Accuracy Polyline (Amber) */}
      <polyline
        fill="none"
        stroke="#f59e0b"
        strokeWidth="1.5"
        strokeDasharray="4,4"
        points={timingPoints}
      />

      {/* Pitch Accuracy Polyline (Emerald) */}
      <polyline
        fill="none"
        stroke="#10b981"
        strokeWidth="2"
        points={pitchPoints}
      />

      {/* Overall Score Polyline (Cyan) */}
      <polyline
        fill="none"
        stroke="#06b6d4"
        strokeWidth="3"
        points={overallPoints}
      />

      {/* Interactive Dots */}
      {sessions.map((s, i) => {
        const cx = getX(i);
        const cy = getY(s.overall_score);
        return (
          <g
            key={s.id}
            onMouseEnter={() => onHoverSession(s)}
            className="cursor-pointer group"
          >
            <circle
              cx={cx}
              cy={cy}
              r="4.5"
              fill="#06b6d4"
              stroke="#0f172a"
              strokeWidth="2"
              className="transition-all hover:scale-125"
            />
            <text
              x={cx}
              y={h - 4}
              fill="#64748b"
              fontSize="9"
              textAnchor="middle"
              fontFamily="monospace"
            >
              #{i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
