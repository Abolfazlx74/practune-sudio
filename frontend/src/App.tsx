import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import type { TabType } from './components/Navbar';
import { Dashboard } from './components/Dashboard';
import { AudioWorkspace } from './components/AudioWorkspace';
import { VisualizationHub } from './components/VisualizationHub';
import { PracticeStudio } from './components/PracticeStudio';
import { SettingsModal } from './components/SettingsModal';
import { SmartHistoryModal } from './components/SmartHistoryModal';
import { SaveProjectModal } from './components/SaveProjectModal';
import { UnsavedChangesModal } from './components/UnsavedChangesModal';
import type { AudioInfo, Project, TranscriptionResult } from './types';
import {
  saveProject,
  saveProjectAs,
  generateAssetId,
} from './services/projectService';

export function App() {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null);
  const [transcription, setTranscription] = useState<TranscriptionResult | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [centsTolerance, setCentsTolerance] = useState(50.0);

  // Project Management State
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // Modals
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [saveModalMode, setSaveModalMode] = useState<'save' | 'saveAs' | 'rename'>('save');
  const [isUnsavedModalOpen, setIsUnsavedModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void> | void) | null>(null);

  const handleAudioSelected = (audio: AudioInfo) => {
    setAudioInfo(audio);
    setTranscription(null);
    setActiveProject(null);
    setIsDirty(false);
  };

  const handleTranscriptionComplete = (data: TranscriptionResult) => {
    setTranscription(data);
    setIsDirty(true);
    setActiveTab('visualization');
  };

  const handleTranscriptionUpdate = (updated: TranscriptionResult) => {
    setTranscription(updated);
    setIsDirty(true);
  };

  // Guard for unsaved changes before loading a different audio file or project
  const requestActionWithUnsavedCheck = (action: () => Promise<void> | void) => {
    if (isDirty) {
      setPendingAction(() => action);
      setIsUnsavedModalOpen(true);
    } else {
      action();
    }
  };

  // Save Project Handler
  const handleSaveProject = async () => {
    if (!audioInfo) return;

    if (activeProject) {
      const updated: Project = {
        ...activeProject,
        audioInfo,
        transcription,
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      };
      await saveProject(updated);
      setActiveProject(updated);
      setIsDirty(false);
    } else {
      setSaveModalMode('save');
      setIsSaveModalOpen(true);
    }
  };

  // Save As Handler
  const handleSaveAsProject = () => {
    if (!audioInfo) return;
    setSaveModalMode('saveAs');
    setIsSaveModalOpen(true);
  };

  // Confirm Save Modal (Save or Save As)
  const handleConfirmSaveModal = async (name: string) => {
    if (!audioInfo) return;
    setIsSaveModalOpen(false);

    if (saveModalMode === 'save') {
      const assetId = generateAssetId(
        audioInfo.original_filename,
        audioInfo.file_size || audioInfo.duration
      );
      const newProj: Project = {
        id: `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name,
        assetId,
        audioInfo,
        transcription,
        configurations: activeProject?.configurations || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      };
      const saved = await saveProject(newProj);
      setActiveProject(saved);
      setIsDirty(false);
    } else if (saveModalMode === 'saveAs') {
      const assetId = activeProject
        ? activeProject.assetId
        : generateAssetId(audioInfo.original_filename, audioInfo.file_size || audioInfo.duration);

      const base: Project = activeProject || {
        id: `proj_${Date.now()}`,
        name,
        assetId,
        audioInfo,
        transcription,
        configurations: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      };

      const cloned = await saveProjectAs(base, name);
      setActiveProject(cloned);
      setIsDirty(false);
    }
  };

  // Open / Restore Project
  const handleOpenProject = (project: Project) => {
    const doOpen = () => {
      setActiveProject(project);
      setAudioInfo(project.audioInfo);
      setTranscription(project.transcription);
      setIsDirty(false);
      setIsHistoryOpen(false);

      if (project.transcription) {
        setActiveTab('visualization');
      } else {
        setActiveTab('workspace');
      }
    };

    if (isDirty) {
      setPendingAction(() => doOpen);
      setIsUnsavedModalOpen(true);
    } else {
      doOpen();
    }
  };

  // Unsaved Changes Modal Actions
  const handleUnsavedSaveAndContinue = async () => {
    setIsUnsavedModalOpen(false);
    if (activeProject && audioInfo) {
      const updated: Project = {
        ...activeProject,
        audioInfo,
        transcription,
        updatedAt: new Date().toISOString(),
      };
      await saveProject(updated);
    } else if (audioInfo) {
      const cleanName = audioInfo.original_filename.replace(/\.[^/.]+$/, '');
      const assetId = generateAssetId(
        audioInfo.original_filename,
        audioInfo.file_size || audioInfo.duration
      );
      const newProj: Project = {
        id: `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: cleanName || 'Practice Project',
        assetId,
        audioInfo,
        transcription,
        configurations: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      };
      await saveProject(newProj);
    }
    setIsDirty(false);
    if (pendingAction) {
      await pendingAction();
      setPendingAction(null);
    }
  };

  const handleUnsavedDiscardAndContinue = async () => {
    setIsUnsavedModalOpen(false);
    setIsDirty(false);
    if (pendingAction) {
      await pendingAction();
      setPendingAction(null);
    }
  };

  const handleUnsavedCancel = () => {
    setIsUnsavedModalOpen(false);
    setPendingAction(null);
  };

  return (
    <div className="min-h-screen bg-[#070a10] text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-slate-950">
      {/* Studio Header Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        hasAudio={!!audioInfo}
        hasTranscription={!!transcription}
        activeProject={activeProject}
        isDirty={isDirty}
        onSaveProject={handleSaveProject}
        onSaveAsProject={handleSaveAsProject}
      />

      {/* Main Studio Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === 'dashboard' && (
          <Dashboard
            onSelectAudio={handleAudioSelected}
            onOpenProject={handleOpenProject}
            onOpenHistory={() => setIsHistoryOpen(true)}
            onNavigateToWorkspace={() => setActiveTab('workspace')}
            isDirty={isDirty}
            onRequestImportWithCheck={requestActionWithUnsavedCheck}
          />
        )}

        {activeTab === 'workspace' && (
          <AudioWorkspace
            audioInfo={audioInfo}
            onAudioSelected={handleAudioSelected}
            onTranscriptionComplete={handleTranscriptionComplete}
            isTranscribing={isTranscribing}
            setIsTranscribing={setIsTranscribing}
            isDirty={isDirty}
            onRequestImportWithCheck={requestActionWithUnsavedCheck}
            onWorkspaceModified={() => setIsDirty(true)}
            onSaveProject={handleSaveProject}
          />
        )}

        {activeTab === 'visualization' && transcription && audioInfo && (
          <VisualizationHub
            transcription={transcription}
            audioInfo={audioInfo}
            onTranscriptionUpdate={handleTranscriptionUpdate}
            onNavigateToPractice={() => setActiveTab('practice')}
          />
        )}

        {activeTab === 'practice' && transcription && audioInfo && (
          <PracticeStudio
            transcription={transcription}
            audioId={audioInfo.id}
            audioInfo={audioInfo}
            currentProjectId={activeProject?.id}
            onOpenProject={handleOpenProject}
            onRestoreTrack={(newAudio, newTranscription) => {
              setAudioInfo(newAudio);
              setTranscription(newTranscription);
              setIsDirty(true);
              setActiveTab('practice');
            }}
            onPracticeModified={() => setIsDirty(true)}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsModal
            centsTolerance={centsTolerance}
            setCentsTolerance={setCentsTolerance}
          />
        )}
      </main>

      {/* Smart Performance History Modal (Unified Project Library) */}
      {isHistoryOpen && (
        <SmartHistoryModal
          currentProjectId={activeProject?.id}
          currentAudioId={audioInfo?.id}
          onClose={() => setIsHistoryOpen(false)}
          onOpenProject={handleOpenProject}
          onApplySettingsOnly={(settings) => {
            setIsHistoryOpen(false);
            setActiveTab('practice');
          }}
        />
      )}

      {/* Save / Save As Modal */}
      <SaveProjectModal
        isOpen={isSaveModalOpen}
        mode={saveModalMode}
        initialName={
          saveModalMode === 'saveAs'
            ? `${activeProject?.name || 'Project'} (Copy)`
            : activeProject?.name ||
              audioInfo?.original_filename.replace(/\.[^/.]+$/, '') ||
              'My Practice Project'
        }
        onConfirm={handleConfirmSaveModal}
        onClose={() => setIsSaveModalOpen(false)}
      />

      {/* Unsaved Changes Confirmation Modal */}
      <UnsavedChangesModal
        isOpen={isUnsavedModalOpen}
        projectName={activeProject?.name || 'Current Workspace'}
        onSaveAndContinue={handleUnsavedSaveAndContinue}
        onDiscardAndContinue={handleUnsavedDiscardAndContinue}
        onCancel={handleUnsavedCancel}
      />

      {/* DAW Footer Status Bar */}
      <footer className="h-8 border-t border-slate-800/80 bg-slate-950/80 px-6 flex items-center justify-between text-[11px] text-slate-400 font-mono">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            Backend Engine: Connected (Port 8000)
          </span>
          <span>•</span>
          <span>Sample Rate: {audioInfo ? `${audioInfo.sample_rate} Hz` : '22.05 kHz'}</span>
          <span>•</span>
          <span>Vocal DSP: Active</span>
          {activeProject && (
            <>
              <span>•</span>
              <span className="text-cyan-400">Project: {activeProject.name}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span>Practune Studio v1.0 MVP</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
