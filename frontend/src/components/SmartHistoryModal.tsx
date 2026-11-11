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
  Edit3,
} from 'lucide-react';
import type {
  AudioInfo,
  PerformanceRecord,
  PracticeConfigSettings,
  PracticeConfiguration,
  Project,
  TranscriptionResult,
} from '../types';
import {
  getAllProjects,
  deleteProject,
  renameProject,
  clearAllProjects,
  relinkProjectAudio,
  getAudioBlob,
} from '../services/projectService';
import { getAudioInfo, uploadAudio } from '../services/api';

interface SmartHistoryModalProps {
  currentAudioId?: string;
  currentProjectId?: string;
  onClose: () => void;
  onOpenProject?: (project: Project) => void;
  onRestore?: (
    audio: AudioInfo,
    transcription: TranscriptionResult,
    settings: PracticeConfigSettings
  ) => void;
  onApplySettingsOnly?: (settings: PracticeConfigSettings) => void;
}

export const SmartHistoryModal: React.FC<SmartHistoryModalProps> = ({
  currentAudioId,
  currentProjectId,
  onClose,
  onOpenProject,
  onRestore,
  onApplySettingsOnly,
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [activeSessionHover, setActiveSessionHover] = useState<PerformanceRecord | null>(null);

  // File status & re-upload state
  const [fileCheckStatus, setFileCheckStatus] = useState<'checking' | 'exists' | 'missing' | 'idle'>('idle');
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [isReuploading, setIsReuploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Inline rename state
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');

  const loadAll = async () => {
    const list = await getAllProjects();
    setProjects(list);

    if (list.length > 0) {
      const match =
        list.find((p) => p.id === currentProjectId) ||
        list.find((p) => p.audioInfo.id === currentAudioId) ||
        list[0];

      setSelectedProjectId(match.id);
      if (match.configurations && match.configurations.length > 0) {
        setSelectedConfigId(match.configurations[0].config_id);
      }
    }
  };

  useEffect(() => {
    loadAll();

    // Prevent background page from scrolling while modal is open
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentAudioId, currentProjectId, onClose]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const selectedConfig =
    selectedProject?.configurations.find((c) => c.config_id === selectedConfigId) ||
    selectedProject?.configurations[0];

  // Verify file existence (backend or local blob) whenever selected project changes
  useEffect(() => {
    if (!selectedProject) {
      setFileCheckStatus('idle');
      return;
    }

    let isMounted = true;
    setFileCheckStatus('checking');
    setRestoreError(null);

    getAudioInfo(selectedProject.audioInfo.id)
      .then(() => {
        if (isMounted) setFileCheckStatus('exists');
      })
      .catch(async () => {
        const cachedBlob = await getAudioBlob(selectedProject.assetId);
        if (isMounted) {
          if (cachedBlob) {
            setFileCheckStatus('exists');
          } else {
            setFileCheckStatus('missing');
          }
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedProject?.id, selectedProject?.assetId]);

  const handleSelectProject = (project: Project) => {
    setSelectedProjectId(project.id);
    if (project.configurations && project.configurations.length > 0) {
      setSelectedConfigId(project.configurations[0].config_id);
    } else {
      setSelectedConfigId('');
    }
  };

  // Delete Handlers
  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this project and all its performance history?')) {
      return;
    }
    await deleteProject(projectId);
    const updated = await getAllProjects();
    setProjects(updated);
    if (selectedProjectId === projectId) {
      if (updated.length > 0) {
        handleSelectProject(updated[0]);
      } else {
        setSelectedProjectId('');
        setSelectedConfigId('');
      }
    }
  };

  const handleDeleteConfig = async (configId: string) => {
    if (!selectedProject) return;
    if (!confirm('Delete this practice configuration and all its session records?')) return;

    selectedProject.configurations = selectedProject.configurations.filter(
      (c) => c.config_id !== configId
    );
    await loadAll();
  };

  const handleDeleteSession = async (recordId: string) => {
    if (!selectedProject || !selectedConfig) return;
    selectedConfig.sessions = selectedConfig.sessions.filter((s) => s.id !== recordId);
    if (selectedConfig.sessions.length > 0) {
      selectedConfig.first_score = selectedConfig.sessions[0].overall_score;
      selectedConfig.latest_score =
        selectedConfig.sessions[selectedConfig.sessions.length - 1].overall_score;
      selectedConfig.best_score = Math.max(
        ...selectedConfig.sessions.map((s) => s.overall_score)
      );
    }
    await loadAll();
  };

  const handleClearAll = async () => {
    if (
      !confirm(
        'Are you sure you want to clear ALL practice history and projects? This action cannot be undone.'
      )
    ) {
      return;
    }
    await clearAllProjects();
    setProjects([]);
    setSelectedProjectId('');
    setSelectedConfigId('');
  };

  // Restore track and configuration into studio
  const handleOpenProject = async () => {
    if (!selectedProject) return;

    // If it's already the current active project, apply settings directly
    if (
      (selectedProject.id === currentProjectId ||
        selectedProject.audioInfo.id === currentAudioId) &&
      selectedConfig &&
      onApplySettingsOnly
    ) {
      onApplySettingsOnly(selectedConfig.settings);
      onClose();
      return;
    }

    setIsRestoring(true);
    setRestoreError(null);

    try {
      if (onOpenProject) {
        onOpenProject(selectedProject);
        onClose();
      } else if (onRestore && selectedConfig && selectedProject.transcription) {
        onRestore(
          selectedProject.audioInfo,
          selectedProject.transcription,
          selectedConfig.settings
        );
        onClose();
      }
    } catch (err: any) {
      setRestoreError(
        `Track Not Found: The audio file for "${selectedProject.name}" could not be located.`
      );
      setFileCheckStatus('missing');
    } finally {
      setIsRestoring(false);
    }
  };

  // Rename Project
  const handleStartRename = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProjectId(project.id);
    setEditingName(project.name);
  };

  const handleSaveRename = async (projectId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (editingName.trim()) {
      await renameProject(projectId, editingName.trim());
      setEditingProjectId(null);
      await loadAll();
    }
  };

  // Re-link missing file
  const handleFileReupload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProject) return;

    setIsReuploading(true);
    setRestoreError(null);

    try {
      const newAudio = await uploadAudio(file);
      await relinkProjectAudio(selectedProject.id, newAudio, file);
      await loadAll();
      setFileCheckStatus('exists');
    } catch (err: any) {
      setRestoreError(`Failed to link file: ${err.message}`);
    } finally {
      setIsReuploading(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        backgroundColor: 'rgba(2, 6, 23, 0.85)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
        overflow: 'hidden',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="daw-panel border border-slate-800 bg-slate-900/95 shadow-2xl rounded-2xl"
        style={{
          maxWidth: '72rem',
          width: '100%',
          height: '88vh',
          maxHeight: '840px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Modal Header */}
        <div className="p-4 px-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-700/60 text-cyan-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Smart Performance History
              </h2>
              <p className="text-xs text-slate-400">
                Track library, configurations, and progress analytics
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl bg-slate-800 hover:bg-slate-750 transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body: 2-Column Library & Analytics Layout */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flex: '1 1 0%',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* Left Column: Track / Project Library */}
          <div
            style={{
              width: '300px',
              minWidth: '300px',
              maxWidth: '300px',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'rgba(2, 6, 23, 0.6)',
              borderRight: '1px solid #1e293b',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            <div className="p-3 border-b border-slate-800 flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Music className="w-3.5 h-3.5 text-cyan-400" />
                Track Library ({projects.length})
              </span>
              {projects.length > 0 && (
                <button
                  onClick={handleClearAll}
                  className="text-[11px] text-rose-400 hover:text-rose-300 font-semibold bg-transparent hover:bg-rose-950/40 px-2 py-1 rounded-lg border-0 transition-colors cursor-pointer"
                  title="Clear all history"
                >
                  Clear All
                </button>
              )}
            </div>

            {projects.length === 0 ? (
              <div className="p-8 text-center text-slate-500 space-y-2 flex-1 overflow-y-auto">
                <History className="w-8 h-8 mx-auto opacity-30" />
                <p className="text-xs">No practice history recorded yet.</p>
                <p className="text-[11px] text-slate-600">
                  Complete a practice session or save a project to start tracking your vocal progress.
                </p>
              </div>
            ) : (
              <div
                className="p-2 space-y-1.5"
                style={{
                  flex: '1 1 0%',
                  overflowY: 'auto',
                  minHeight: 0,
                  overscrollBehavior: 'contain',
                }}
              >
                {projects.map((project) => {
                  const isSelected = project.id === selectedProjectId;
                  const totalSessions = project.configurations?.reduce(
                    (acc, c) => acc + c.sessions.length,
                    0
                  ) || 0;
                  const latestScore =
                    project.configurations && project.configurations[0]?.latest_score !== undefined
                      ? project.configurations[0].latest_score
                      : null;

                  return (
                    <div
                      key={project.id}
                      onClick={() => handleSelectProject(project)}
                      className={`group p-3 rounded-xl border transition-all cursor-pointer overflow-hidden ${
                        isSelected
                          ? 'bg-slate-900 border-cyan-500/50 shadow-md shadow-cyan-950/30'
                          : 'bg-slate-950/80 border-slate-800/80 hover:bg-slate-900/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <div className="min-w-0 flex-1 overflow-hidden">
                          {editingProjectId === project.id ? (
                            <form
                              onSubmit={(e) => handleSaveRename(project.id, e)}
                              className="flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="text"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                autoFocus
                                className="w-full px-2 py-0.5 rounded bg-slate-950 border border-cyan-500 text-xs text-white"
                              />
                              <button
                                type="submit"
                                className="text-[10px] px-2 py-0.5 rounded bg-cyan-500 text-slate-950 font-bold"
                              >
                                Save
                              </button>
                            </form>
                          ) : (
                            <h4
                              className="text-xs font-bold text-white truncate block w-full text-ellipsis overflow-hidden"
                              title={project.name}
                            >
                              {project.name}
                            </h4>
                          )}

                          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                            <span>{project.audioInfo.duration.toFixed(1)}s</span>
                            <span>•</span>
                            <span>
                              {project.configurations.length} config
                              {project.configurations.length === 1 ? '' : 's'}
                            </span>
                            <span>•</span>
                            <span>
                              {totalSessions} session{totalSessions === 1 ? '' : 's'}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          {latestScore !== null && (
                            <span className="px-2 py-0.5 rounded-lg bg-cyan-950 border border-cyan-800/60 font-mono text-xs font-bold text-cyan-400">
                              {latestScore}%
                            </span>
                          )}

                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => handleStartRename(project, e)}
                              className="text-slate-500 hover:text-cyan-300 p-1 rounded-lg bg-transparent hover:bg-slate-800 transition-all cursor-pointer"
                              title="Rename Project"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteProject(project.id, e)}
                              className="text-slate-500 hover:text-rose-400 p-1 rounded-lg bg-transparent hover:bg-rose-950/50 transition-all border-0 flex items-center justify-center cursor-pointer"
                              title="Delete Project"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Analytics, Progress Charts & Restoration */}
          <div
            className="p-5 space-y-5"
            style={{
              flex: '1 1 0%',
              height: '100%',
              overflowY: 'auto',
              minHeight: 0,
              overscrollBehavior: 'contain',
            }}
          >
            {!selectedProject ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                <Music className="w-10 h-10 opacity-30" />
                <p className="text-sm">Select a track from the library to view performance analytics.</p>
              </div>
            ) : (
              <>
                {/* Track Details & Restoration Header */}
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1 overflow-hidden">
                    <div className="flex items-center gap-2">
                      <h3
                        className="text-base font-bold text-white truncate max-w-sm sm:max-w-md"
                        title={selectedProject.name}
                      >
                        {selectedProject.name}
                      </h3>
                      {(selectedProject.id === currentProjectId ||
                        selectedProject.audioInfo.id === currentAudioId) && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-400 shrink-0">
                          ACTIVE IN STUDIO
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span>File: {selectedProject.audioInfo.original_filename}</span>
                      <span>•</span>
                      <span>Duration: {selectedProject.audioInfo.duration.toFixed(1)}s</span>
                      <span>•</span>
                      <span>Last Practiced: {new Date(selectedProject.updatedAt).toLocaleDateString()}</span>
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
                  <div className="flex items-center gap-2 shrink-0">
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
                        onClick={handleOpenProject}
                        disabled={isRestoring || fileCheckStatus !== 'exists'}
                        className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-md shadow-cyan-500/20 disabled:opacity-40 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        {selectedProject.id === currentProjectId ||
                        selectedProject.audioInfo.id === currentAudioId
                          ? 'Apply Settings to Studio'
                          : 'Restore Project & Practice'}
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
                      <span>
                        {restoreError} Use the "Locate & Re-upload Audio" button to re-link this project.
                      </span>
                    </div>
                  </div>
                )}

                {/* Practice Configuration Selector Tabs */}
                {selectedProject.configurations && selectedProject.configurations.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-cyan-400" />
                        Practice Configurations ({selectedProject.configurations.length})
                      </span>
                      {selectedConfig && selectedProject.configurations.length > 1 && (
                        <button
                          onClick={() => handleDeleteConfig(selectedConfig.config_id)}
                          className="text-[11px] text-slate-500 hover:text-rose-400 transition-colors bg-transparent hover:bg-rose-950/30 px-2 py-0.5 rounded-lg border-0 cursor-pointer"
                        >
                          Delete This Configuration
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {selectedProject.configurations.map((cfg) => {
                        const isSelected = cfg.config_id === selectedConfig?.config_id;
                        return (
                          <button
                            key={cfg.config_id}
                            onClick={() => setSelectedConfigId(cfg.config_id)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border flex items-center gap-1.5 cursor-pointer ${
                              isSelected
                                ? 'bg-cyan-950/80 border-cyan-600 text-cyan-300 shadow-sm'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                            }`}
                          >
                            <span>{cfg.label}</span>
                            <span className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono">
                              {cfg.sessions.length}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Performance Analytics & Progress Charts */}
                {selectedConfig && (
                  <div className="space-y-5">
                    {/* Metrics Overview Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between text-slate-400 text-xs">
                          <span>Latest Score</span>
                          <Award className="w-3.5 h-3.5 text-cyan-400" />
                        </div>
                        <div className="text-xl font-bold font-mono text-cyan-400">
                          {selectedConfig.latest_score}%
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between text-slate-400 text-xs">
                          <span>Best Score</span>
                          <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                        </div>
                        <div className="text-xl font-bold font-mono text-amber-400">
                          {selectedConfig.best_score}%
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between text-slate-400 text-xs">
                          <span>First Score</span>
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                        </div>
                        <div className="text-xl font-bold font-mono text-slate-300">
                          {selectedConfig.first_score}%
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between text-slate-400 text-xs">
                          <span>Total Sessions</span>
                          <Target className="w-3.5 h-3.5 text-purple-400" />
                        </div>
                        <div className="text-xl font-bold font-mono text-purple-400">
                          {selectedConfig.sessions.length}
                        </div>
                      </div>
                    </div>

                    {/* Progress Chart (SVG Trend Curve) */}
                    <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-cyan-400" />
                          <h4 className="text-xs font-semibold text-slate-200">
                            Performance Progress Over Time
                          </h4>
                        </div>
                        {activeSessionHover && (
                          <div className="text-xs font-mono text-cyan-400 flex items-center gap-2">
                            <span>Score: {activeSessionHover.overall_score}%</span>
                            <span>•</span>
                            <span>Pitch: {activeSessionHover.pitch_accuracy}%</span>
                            <span>•</span>
                            <span>Timing: {activeSessionHover.timing_accuracy}%</span>
                          </div>
                        )}
                      </div>

                      <div className="h-44 w-full relative pt-2">
                        {selectedConfig.sessions.length === 1 ? (
                          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                            <span>1 session recorded ({selectedConfig.sessions[0].overall_score}%).</span>
                            <span className="text-[11px] mt-1 text-slate-600">
                              Practice again with this configuration to see your improvement curve!
                            </span>
                          </div>
                        ) : (
                          <svg
                            className="w-full h-full overflow-visible"
                            viewBox="0 0 600 150"
                            preserveAspectRatio="none"
                          >
                            <line x1="0" y1="20" x2="600" y2="20" stroke="#1e293b" strokeDasharray="4 4" />
                            <line x1="0" y1="75" x2="600" y2="75" stroke="#1e293b" strokeDasharray="4 4" />
                            <line x1="0" y1="130" x2="600" y2="130" stroke="#1e293b" strokeDasharray="4 4" />

                            <defs>
                              <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
                                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                              </linearGradient>
                            </defs>

                            {(() => {
                              const points = selectedConfig.sessions.map((s, idx) => {
                                const x =
                                  (idx / (selectedConfig.sessions.length - 1)) * 580 + 10;
                                const y = 130 - (s.overall_score / 100) * 110;
                                return `${x},${y}`;
                              });
                              const pathD = `M ${points.join(' L ')}`;
                              const areaD = `M 10,130 L ${points.join(' L ')} L 590,130 Z`;

                              return (
                                <>
                                  <path d={areaD} fill="url(#chartGradient)" />
                                  <path
                                    d={pathD}
                                    fill="none"
                                    stroke="#06b6d4"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                  />
                                  {selectedConfig.sessions.map((s, idx) => {
                                    const x =
                                      (idx / (selectedConfig.sessions.length - 1)) * 580 + 10;
                                    const y = 130 - (s.overall_score / 100) * 110;
                                    return (
                                      <g key={s.id}>
                                        <circle
                                          cx={x}
                                          cy={y}
                                          r="5"
                                          fill="#06b6d4"
                                          stroke="#0f172a"
                                          strokeWidth="2"
                                          className="cursor-pointer hover:r-7 transition-all"
                                          onMouseEnter={() => setActiveSessionHover(s)}
                                          onMouseLeave={() => setActiveSessionHover(null)}
                                        />
                                      </g>
                                    );
                                  })}
                                </>
                              );
                            })()}
                          </svg>
                        )}
                      </div>
                    </div>

                    {/* Practice Session History Table */}
                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Practice Session History ({selectedConfig.sessions.length})
                      </span>
                      <div className="space-y-1.5 max-h-52 overflow-y-auto">
                        {selectedConfig.sessions
                          .slice()
                          .reverse()
                          .map((sess) => (
                            <div
                              key={sess.id}
                              className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-3">
                                <div className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-cyan-400">
                                  <Calendar className="w-3.5 h-3.5" />
                                </div>
                                <div>
                                  <span className="text-slate-300 font-mono">
                                    {new Date(sess.timestamp).toLocaleString()}
                                  </span>
                                  <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                                    <span>Pitch: {sess.pitch_accuracy}%</span>
                                    <span>•</span>
                                    <span>Timing: {sess.timing_accuracy}%</span>
                                    <span>•</span>
                                    <span>Sequence: {sess.sequence_accuracy}%</span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className="font-mono font-bold text-cyan-400 text-sm">
                                  {sess.overall_score}%
                                </span>
                                <button
                                  onClick={() => handleDeleteSession(sess.id)}
                                  className="text-slate-600 hover:text-rose-400 p-1 rounded hover:bg-slate-900 transition-colors cursor-pointer"
                                  title="Delete Session Record"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
