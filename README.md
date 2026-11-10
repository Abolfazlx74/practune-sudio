# Practune — AI Music Analysis & Learning Studio

**Practune** is an AI-powered music analysis and interactive vocal learning platform. It transforms uploaded audio into actionable musical data—extracting notes, visualizing melodies on an interactive piano roll, musical staff, and pitch contour timeline, applying FL Studio NewTone-inspired pitch centering, and providing a real-time vocal practice studio with live pitch tracking and performance evaluation.

---

## Architecture Overview

```
practune/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI application router & endpoints
│   │   ├── config.py                # Storage, upload dirs, and audio settings
│   │   ├── models/
│   │   │   └── schemas.py           # Pydantic data schemas
│   │   └── services/
│   │       ├── audio_service.py     # File I/O, format validation, waveform peaks
│   │       ├── dsp_service.py       # Noise reduction (spectral gating) & peak norm
│   │       ├── dsp_utils.py         # YIN F0 pitch tracking & onset detection
│   │       ├── pitch_transcription.py# Audio-to-note segmentation & key/BPM analysis
│   │       ├── pitch_correction.py   # NewTone-style pitch centering & variation smoothing
│   │       ├── practice_service.py   # Evaluation engine (cents tolerance, timing, feedback)
│   │       └── music_export.py       # MIDI (.mid) & MusicXML (.musicxml) generators
│   └── venv/                        # Python virtual environment
├── frontend/
│   ├── src/
│   │   ├── App.tsx                  # Main studio interface
│   │   ├── components/
│   │   │   ├── Navbar.tsx           # DAW navigation header
│   │   │   ├── Dashboard.tsx        # Session library, dropzone, demo generator
│   │   │   ├── AudioWorkspace.tsx   # Waveform scrubber, DSP preprocessing controls
│   │   │   ├── PianoRoll.tsx        # Canvas DAW piano roll with synth audition & editing
│   │   │   ├── PitchTimeline.tsx    # Continuous F0 pitch contour vs simplified melody
│   │   │   ├── SheetMusicView.tsx   # Musical notation staff & MusicXML renderer
│   │   │   ├── PitchCorrectionControls.tsx # FL Studio NewTone sliders
│   │   │   ├── PracticeStudio.tsx   # Dual-layer live microphone pitch tracker
│   │   │   ├── EvaluationModal.tsx  # Score breakdown, note table, confetti
│   │   │   └── SettingsModal.tsx    # Practice tolerance & DSP thresholds
│   │   ├── services/
│   │   │   ├── api.ts               # Backend API client
│   │   │   ├── synth.ts             # Web Audio polyphonic synthesizer
│   │   │   └── micPitchTracker.ts   # 60 FPS client-side YIN pitch detector
│   │   └── types/index.ts           # TypeScript type definitions
│   └── package.json
└── test_e2e_api.py                  # End-to-end integration test suite
```

---

## Core Features

### 1. Audio Import & Management (Module A)
- **Supported Formats**: WAV, MP3, FLAC, OGG.
- **Drag-and-Drop**: Immediate upload and metadata inspection (duration, format, sample rate, channels, waveform peak data).
- **Interactive Waveform**: Scrubbing, seeking, time display, and loop selection.
- **Non-Destructive**: Original audio is strictly preserved.

### 2. Audio Preprocessing (Module B)
- **Stationary Noise Reduction**: Spectral gating with adjustable intensity (10% to 100%).
- **Loudness Normalization**: Normalizes peaks to -1.0 dBFS to stabilize pitch detection thresholds.
- **A/B Comparison**: Toggle between original and cleaned versions without losing original data.

### 3. Automatic Music Transcription (Module C)
- **Pitch Detection & Segmentation**: Probabilistic YIN fundamental frequency tracking combined with spectral flux onset detection.
- **Musical Analysis**: Key and scale estimation (Krumhansl-Schmuckler chromagram profile matching) and BPM estimation.
- **Note Attributes**: Note name, octave, MIDI pitch, start/end timestamps, duration, confidence, and cents deviation.

### 4. FL Studio NewTone Pitch Simplification (Module D)
- **Pitch Center Snap**: Attracts microtonal pitch variations toward exact semitones.
- **Pitch Variation Reduction**: Smooths vibrato and tremor within sustained notes.
- **A/B Toggle**: Switch between raw transcription and smoothed melody.

### 5. Music Visualization (Module E)
- **Interactive Piano Roll**: Zoomable, pannable canvas with clickable synth note auditions and note editing.
- **Pitch Timeline**: Continuous $f_0$ contour curve superimposed over target note blocks.
- **Sheet Music**: Rendered standard musical staff with active note highlighting and MusicXML export.

### 6. Real-Time Vocal Practice Studio (Module F)
- **Microphone Input**: Browser Web Audio API stream with RMS Voice Activity Detection.
- **Real-Time YIN Tracking**: Client-side pitch estimation at 60 FPS.
- **Dual-Layer Visualizer**: Target reference melody bars synchronized with the user's live singing pitch curve (green for on-pitch, amber for drift).
- **Scoring & Feedback**: Transparent multi-factor evaluation (Pitch Accuracy, Timing Accuracy, Note Sequence Accuracy, and targeted musical coaching hints).

### 7. Additional Features
- **Slow Playback**: 50%, 75%, and 100% time-stretching with pitch preservation.
- **Key Shift / Transpose**: Shift reference melody by $\pm N$ semitones for vocal comfort.
- **Export Formats**: Standard MIDI (.mid), MusicXML (.musicxml), and JSON.

---

## Running Locally

### 1. Start Backend
```powershell
backend\venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```
Backend API will be available at: `http://127.0.0.1:8000` (docs at `http://127.0.0.1:8000/docs`).

### 2. Start Frontend
```powershell
cd frontend
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173
```
Frontend Studio will be live at: `http://127.0.0.1:5173`.

### 3. Run Automated End-to-End Verification
```powershell
backend\venv\Scripts\python.exe test_e2e_api.py
```
