import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import type { TabType } from './components/Navbar';
import { Dashboard } from './components/Dashboard';
import { AudioWorkspace } from './components/AudioWorkspace';
import { VisualizationHub } from './components/VisualizationHub';
import { PracticeStudio } from './components/PracticeStudio';
import { SettingsModal } from './components/SettingsModal';
import type { AudioInfo, TranscriptionResult } from './types';

export function App() {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null);
  const [transcription, setTranscription] = useState<TranscriptionResult | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [centsTolerance, setCentsTolerance] = useState(50.0);

  const handleAudioSelected = (audio: AudioInfo) => {
    setAudioInfo(audio);
    setTranscription(null);
  };

  const handleTranscriptionComplete = (data: TranscriptionResult) => {
    setTranscription(data);
    setActiveTab('visualization');
  };

  return (
    <div className="min-h-screen bg-[#070a10] text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-slate-950">
      {/* Studio Header Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        hasAudio={!!audioInfo}
        hasTranscription={!!transcription}
      />

      {/* Main Studio Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === 'dashboard' && (
          <Dashboard
            onSelectAudio={handleAudioSelected}
            onNavigateToWorkspace={() => setActiveTab('workspace')}
          />
        )}

        {activeTab === 'workspace' && (
          <AudioWorkspace
            audioInfo={audioInfo}
            onAudioSelected={handleAudioSelected}
            onTranscriptionComplete={handleTranscriptionComplete}
            isTranscribing={isTranscribing}
            setIsTranscribing={setIsTranscribing}
          />
        )}

        {activeTab === 'visualization' && transcription && audioInfo && (
          <VisualizationHub
            transcription={transcription}
            audioInfo={audioInfo}
            onTranscriptionUpdate={(updated) => setTranscription(updated)}
            onNavigateToPractice={() => setActiveTab('practice')}
          />
        )}

        {activeTab === 'practice' && transcription && audioInfo && (
          <PracticeStudio
            transcription={transcription}
            audioId={audioInfo.id}
            audioInfo={audioInfo}
            onRestoreTrack={(newAudio, newTranscription) => {
              setAudioInfo(newAudio);
              setTranscription(newTranscription);
              setActiveTab('practice');
            }}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsModal
            centsTolerance={centsTolerance}
            setCentsTolerance={setCentsTolerance}
          />
        )}
      </main>

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
        </div>

        <div className="flex items-center gap-3">
          <span>Practune Studio v1.0 MVP</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
