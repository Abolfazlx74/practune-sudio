import os
import uuid
import json
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
import numpy as np

from ..config import STORAGE_DIR
from ..models.schemas import NoteItem, PitchFrame, TranscriptionResult
from .audio_service import get_audio_filepath, get_audio_info
from .dsp_utils import (
    load_audio,
    compute_yin_pitch,
    detect_onsets,
    estimate_key_chroma,
    estimate_bpm_tempo,
    hz_to_midi,
    midi_to_hz,
)

TRANSCRIPTION_DIR = STORAGE_DIR / "transcriptions"
TRANSCRIPTION_DIR.mkdir(parents=True, exist_ok=True)

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

def midi_to_note_info(midi_num: float) -> Tuple[str, int, float]:
    rounded_midi = int(round(midi_num))
    octave = (rounded_midi // 12) - 1
    note_idx = rounded_midi % 12
    note_name = f"{NOTE_NAMES[note_idx]}{octave}"
    cents_dev = (midi_num - rounded_midi) * 100.0
    return note_name, octave, round(cents_dev, 1)

def run_yin_transcription(y: np.ndarray, sr: int) -> Tuple[List[NoteItem], List[PitchFrame]]:
    hop_length = 512
    frame_length = 2048

    pitch_frames: List[PitchFrame] = []
    num_frames = (len(y) - frame_length) // hop_length

    # Energy gate threshold to ignore silence
    rms_values = [np.sqrt(np.mean(y[i * hop_length:i * hop_length + frame_length]**2)) for i in range(num_frames)]
    peak_rms = float(np.max(rms_values)) if rms_values else 0.1
    energy_threshold = max(0.003, peak_rms * 0.06)

    for i in range(num_frames):
        start = i * hop_length
        chunk = y[start:start + frame_length]
        rms = rms_values[i]
        t = (start + frame_length // 2) / sr

        if rms < energy_threshold:
            continue

        freq, conf = compute_yin_pitch(chunk, sr=sr, fmin=65.4, fmax=2093.0, threshold=0.15)
        if freq > 50.0 and conf > 0.4:
            midi_val = hz_to_midi(freq)
            pitch_frames.append(PitchFrame(
                time=round(t, 3),
                frequency=round(freq, 2),
                midi=round(midi_val, 2),
                confidence=round(conf, 2)
            ))

    onset_times = set([round(t, 2) for t in detect_onsets(y, sr, hop_size=hop_length)])

    # Segment pitch frames into discrete musical notes with vibrato-resistant hysteresis
    notes: List[NoteItem] = []
    current_segment: List[PitchFrame] = []

    def commit_segment(seg: List[PitchFrame]):
        if not seg:
            return
        seg_duration = seg[-1].time - seg[0].time
        if seg_duration < 0.06:
            return

        midis = [f.midi for f in seg]
        weights = [f.confidence for f in seg]
        avg_midi = float(np.average(midis, weights=weights)) if sum(weights) > 0 else float(np.median(midis))
        rounded_midi = int(round(avg_midi))
        note_name, octave, cents_dev = midi_to_note_info(avg_midi)
        freq = float(midi_to_hz(rounded_midi))
        conf = float(np.mean([f.confidence for f in seg]))

        notes.append(NoteItem(
            id=f"n_{uuid.uuid4().hex[:8]}",
            midi=rounded_midi,
            note_name=note_name,
            octave=octave,
            start=round(seg[0].time, 3),
            end=round(seg[-1].time, 3),
            duration=round(max(0.04, seg_duration), 3),
            confidence=round(conf, 2),
            frequency=round(freq, 1),
            cents_deviation=cents_dev
        ))

    # Rolling median (window 3) for hysteresis to avoid fracturing sustained vibrato
    smoothed_midis = []
    for k in range(len(pitch_frames)):
        window = [pitch_frames[j].midi for j in range(max(0, k - 1), min(len(pitch_frames), k + 2))]
        smoothed_midis.append(float(np.median(window)))

    for idx, frame in enumerate(pitch_frames):
        if not current_segment:
            current_segment.append(frame)
            continue

        prev_frame = current_segment[-1]
        time_gap = frame.time - prev_frame.time
        smooth_jump = abs(smoothed_midis[idx] - smoothed_midis[idx - 1])
        is_onset = any(abs(frame.time - ot) < 0.04 for ot in onset_times)

        # Break note on silence gap (> 85ms), distinct onset, or sustained pitch jump (>= 0.85 semitones)
        if time_gap > 0.085 or (smooth_jump >= 0.85 and time_gap > 0.03) or is_onset:
            commit_segment(current_segment)
            current_segment = [frame]
        else:
            current_segment.append(frame)

    if current_segment:
        commit_segment(current_segment)

    return notes, pitch_frames

def transcribe_audio(audio_id: str) -> TranscriptionResult:
    audio_path = get_audio_filepath(audio_id)
    if not audio_path or not audio_path.exists():
        raise FileNotFoundError(f"Audio file for id '{audio_id}' not found.")

    y, sr, duration = load_audio(str(audio_path), target_sr=22050)

    bpm = estimate_bpm_tempo(y, sr)
    key_est, scale_est = estimate_key_chroma(y, sr)

    engine_name = "YIN High-Precision"
    notes: List[NoteItem] = []
    pitch_frames: List[PitchFrame] = []

    # Check for Spotify Basic Pitch if available
    try:
        from basic_pitch.inference import predict
        model_output, midi_data, note_events = predict(str(audio_path))
        for ne in note_events:
            start_t = float(ne[0])
            end_t = float(ne[1])
            midi_pitch = int(round(ne[2]))
            amplitude = float(ne[3]) if len(ne) > 3 else 0.85
            note_name, octave, cents_dev = midi_to_note_info(midi_pitch)
            freq = float(midi_to_hz(midi_pitch))

            notes.append(NoteItem(
                id=f"n_{uuid.uuid4().hex[:8]}",
                midi=midi_pitch,
                note_name=note_name,
                octave=octave,
                start=round(start_t, 3),
                end=round(end_t, 3),
                duration=round(end_t - start_t, 3),
                confidence=round(min(1.0, amplitude), 2),
                frequency=round(freq, 1),
                cents_deviation=cents_dev
            ))
        engine_name = "Spotify Basic Pitch"
        # Continuous pitch contour
        _, pitch_frames = run_yin_transcription(y, sr)
    except Exception:
        # Robust YIN + Onset Segmentation
        notes, pitch_frames = run_yin_transcription(y, sr)
        engine_name = "DSP YIN & Onset Tracker"

    conf_overall = round(float(np.mean([n.confidence for n in notes])), 2) if notes else 0.0

    result = TranscriptionResult(
        audio_id=audio_id,
        notes=notes,
        pitch_contour=pitch_frames,
        bpm=bpm,
        key_estimate=key_est,
        scale_estimate=scale_est,
        duration=round(duration, 2),
        confidence_overall=conf_overall,
        transcription_engine=engine_name
    )

    out_file = TRANSCRIPTION_DIR / f"{audio_id}.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(result.model_dump(), f, indent=2)

    return result

def get_transcription(audio_id: str) -> Optional[TranscriptionResult]:
    out_file = TRANSCRIPTION_DIR / f"{audio_id}.json"
    if not out_file.exists():
        return None
    with open(out_file, "r", encoding="utf-8") as f:
        data = json.load(f)
        return TranscriptionResult(**data)
