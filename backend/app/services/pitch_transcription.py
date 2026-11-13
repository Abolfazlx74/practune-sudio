import os
import uuid
import json
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
import numpy as np

from ..config import STORAGE_DIR
from ..models.schemas import NoteItem, PitchFrame, TranscriptionResult, TransitionRegion, VibratoInfo
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

PIPELINE_VERSION = "2.4.0"
TRANSCRIPTION_DIR = STORAGE_DIR / "transcriptions"
TRANSCRIPTION_DIR.mkdir(parents=True, exist_ok=True)

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

def midi_to_note_info(midi_num: float) -> Tuple[str, int, float]:
    rounded_midi = int(round(midi_num))
    # FL Studio / Yamaha standard convention: MIDI 60 is C5, MIDI 69 is A5 (440Hz), MIDI 70 is A#5
    octave = rounded_midi // 12
    note_idx = rounded_midi % 12
    note_name = f"{NOTE_NAMES[note_idx]}{octave}"
    cents_dev = (midi_num - rounded_midi) * 100.0
    return note_name, octave, round(cents_dev, 1)

def analyze_vibrato(seg_frames: List[PitchFrame], note_id: str, note_midi: int) -> VibratoInfo:
    if len(seg_frames) < 8:
        return VibratoInfo(note_id=note_id, rate_hz=0.0, extent_cents=0.0, has_vibrato=False)

    midis = np.array([f.midi for f in seg_frames], dtype=np.float64)
    cents_dev = (midis - note_midi) * 100.0
    cents_detrended = cents_dev - np.mean(cents_dev)
    peak_to_peak = float(np.percentile(cents_detrended, 90) - np.percentile(cents_detrended, 10))

    duration = seg_frames[-1].time - seg_frames[0].time
    if duration <= 0.08:
        return VibratoInfo(note_id=note_id, rate_hz=0.0, extent_cents=0.0, has_vibrato=False)

    zero_crossings = np.where(np.diff(np.sign(cents_detrended)))[0]
    est_freq = (len(zero_crossings) / 2.0) / duration
    has_vibrato = (3.8 <= est_freq <= 8.5) and (peak_to_peak >= 25.0)

    return VibratoInfo(
        note_id=note_id,
        rate_hz=round(float(est_freq), 1) if has_vibrato else 0.0,
        extent_cents=round(float(peak_to_peak), 1) if has_vibrato else 0.0,
        has_vibrato=has_vibrato
    )

def run_yin_transcription(y: np.ndarray, sr: int) -> Tuple[List[NoteItem], List[PitchFrame], List[TransitionRegion], List[VibratoInfo], bool, Optional[str]]:
    hop_length = 512
    frame_length = 2048

    pitch_frames: List[PitchFrame] = []
    num_frames = (len(y) - frame_length) // hop_length

    if num_frames <= 0:
        return [], [], [], [], True, None

    # Energy gate threshold with adaptive noise floor estimation
    rms_values = [float(np.sqrt(np.mean(y[i * hop_length:i * hop_length + frame_length]**2))) for i in range(num_frames)]
    peak_rms = float(np.max(rms_values)) if rms_values else 0.1
    sorted_rms = sorted(rms_values)
    noise_floor = sorted_rms[int(len(sorted_rms) * 0.10)] if sorted_rms else 0.003
    energy_threshold = max(0.003, min(peak_rms * 0.04, noise_floor * 2.0 + 0.002))

    for i in range(num_frames):
        start = i * hop_length
        chunk = y[start:start + frame_length]
        rms = rms_values[i]
        t = (start + frame_length // 2) / sr

        if rms < energy_threshold:
            continue

        freq, conf = compute_yin_pitch(chunk, sr=sr, fmin=65.4, fmax=2093.0, threshold=0.15)
        if freq > 50.0 and conf > 0.40:
            midi_val = hz_to_midi(freq)
            pitch_frames.append(PitchFrame(
                time=round(t, 3),
                frequency=round(freq, 2),
                midi=round(midi_val, 2),
                confidence=round(conf, 2)
            ))

    if not pitch_frames:
        return [], [], [], [], True, None

    # De-glitch: Remove transient sub-harmonic drops / octave dives (< 3 frames, jump > 6 semitones)
    n_p = len(pitch_frames)
    cleaned_frames: List[PitchFrame] = []
    i = 0
    while i < n_p:
        curr = pitch_frames[i]
        prev_f = cleaned_frames[-1] if cleaned_frames else None
        next_f = pitch_frames[i + 1] if i < n_p - 1 else None
        next2_f = pitch_frames[i + 2] if i < n_p - 2 else None

        # 2-frame plunge
        if prev_f and next_f and next2_f and abs(curr.time - prev_f.time) < 0.06:
            if (prev_f.midi - curr.midi > 6.0) and (next2_f.midi - curr.midi > 6.0) and \
               (prev_f.midi - next_f.midi > 6.0) and (next2_f.midi - next_f.midi > 6.0) and \
               abs(prev_f.midi - next2_f.midi) <= 10.0:
                i += 2
                continue

        # 1-frame plunge
        if prev_f and next_f and abs(curr.time - prev_f.time) < 0.06 and abs(next_f.time - curr.time) < 0.06:
            if (prev_f.midi - curr.midi > 6.0) and (next_f.midi - curr.midi > 6.0) and abs(prev_f.midi - next_f.midi) <= 10.0:
                i += 1
                continue

        cleaned_frames.append(curr)
        i += 1

    pitch_frames = cleaned_frames
    if not pitch_frames:
        return [], [], [], [], True, None

    onset_times = set([round(t, 2) for t in detect_onsets(y, sr, hop_size=hop_length)])

    # Rolling median filter (window 3) for hysteresis and sub-harmonic suppression
    smoothed_midis = []
    for k in range(len(pitch_frames)):
        window = [pitch_frames[j].midi for j in range(max(0, k - 1), min(len(pitch_frames), k + 2))]
        smoothed_midis.append(float(np.median(window)))

    # Segment pitch frames into discrete musical notes
    notes: List[NoteItem] = []
    vibratos: List[VibratoInfo] = []
    current_segment: List[PitchFrame] = []

    def commit_segment(seg: List[PitchFrame]):
        if not seg:
            return
        seg_duration = seg[-1].time - seg[0].time
        if seg_duration < 0.05:
            return

        midis = [f.midi for f in seg]
        med_midi = float(np.median(midis))
        rounded_midi = int(round(med_midi))
        note_name, octave, cents_dev = midi_to_note_info(med_midi)
        freq = float(midi_to_hz(rounded_midi))
        conf = float(np.mean([f.confidence for f in seg]))

        # Deterministic note ID based on timing and pitch for 100% test reproducibility
        note_uid = f"n_{int(seg[0].time * 1000):06d}_{rounded_midi}"

        notes.append(NoteItem(
            id=note_uid,
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

        # Detect vibrato within this note
        vib = analyze_vibrato(seg, note_uid, rounded_midi)
        if vib.has_vibrato:
            vibratos.append(vib)

    for idx, frame in enumerate(pitch_frames):
        if not current_segment:
            current_segment.append(frame)
            continue

        prev_frame = current_segment[-1]
        time_gap = frame.time - prev_frame.time
        smooth_jump = abs(smoothed_midis[idx] - smoothed_midis[idx - 1])
        is_onset = any(abs(frame.time - ot) < 0.04 for ot in onset_times)

        # Break note on silence gap (> 80ms), distinct onset with pitch change (>= 0.45 st), or clear pitch jump (>= 0.75 st)
        should_split = (time_gap > 0.080) or (smooth_jump >= 0.75) or (is_onset and smooth_jump >= 0.45)
        if should_split:
            commit_segment(current_segment)
            current_segment = [frame]
        else:
            current_segment.append(frame)

    if current_segment:
        commit_segment(current_segment)

    # Detect Pitch Transitions (Slides, Portamento between consecutive notes)
    transitions: List[TransitionRegion] = []
    for i in range(len(notes) - 1):
        n1 = notes[i]
        n2 = notes[i + 1]
        gap_start = n1.end
        gap_end = n2.start
        # Inter-note sliding frames
        inter_frames = [f for f in pitch_frames if gap_start - 0.04 <= f.time <= gap_end + 0.04]
        if inter_frames and abs(n2.midi - n1.midi) >= 1:
            transitions.append(TransitionRegion(
                start=round(inter_frames[0].time, 3),
                end=round(inter_frames[-1].time, 3),
                from_note=n1.note_name,
                to_note=n2.note_name,
                from_midi=float(n1.midi),
                to_midi=float(n2.midi),
                transition_type="slide"
            ))

    # Audio suitability & polyphony analysis
    is_monophonic = True
    suitability_warning = None
    if len(pitch_frames) >= 15:
        jumps = [abs(pitch_frames[k].midi - pitch_frames[k-1].midi) for k in range(1, len(pitch_frames))]
        erratic_jumps = sum(1 for j in jumps if j >= 7.0)
        erratic_ratio = erratic_jumps / len(jumps)
        avg_conf = float(np.mean([f.confidence for f in pitch_frames]))
        if erratic_ratio > 0.35 and avg_conf < 0.65:
            is_monophonic = False
            suitability_warning = (
                "Audio appears to contain polyphonic accompaniment, dense chords, or background instrumentation. "
                "For highest pitch-tracking and scoring accuracy, solo vocal or single-instrument audio is recommended."
            )

    return notes, pitch_frames, transitions, vibratos, is_monophonic, suitability_warning

def transcribe_audio(audio_id: str) -> TranscriptionResult:
    audio_path = get_audio_filepath(audio_id)
    if not audio_path or not audio_path.exists():
        raise FileNotFoundError(f"Audio file for id '{audio_id}' not found.")

    y, sr, duration = load_audio(str(audio_path), target_sr=22050)

    bpm = estimate_bpm_tempo(y, sr)
    key_est, scale_est = estimate_key_chroma(y, sr)

    # Use High-Precision DSP YIN & Onset Segmentation for mathematical pitch fidelity
    notes, pitch_frames, transitions, vibratos, is_mono, suit_warn = run_yin_transcription(y, sr)
    engine_name = "DSP YIN & Onset Tracker"

    conf_overall = round(float(np.mean([n.confidence for n in notes])), 2) if notes else 0.0

    result = TranscriptionResult(
        audio_id=audio_id,
        notes=notes,
        pitch_contour=pitch_frames,
        transitions=transitions,
        vibratos=vibratos,
        bpm=bpm,
        key_estimate=key_est,
        scale_estimate=scale_est,
        duration=round(duration, 2),
        confidence_overall=conf_overall,
        transcription_engine=engine_name,
        pipeline_version=PIPELINE_VERSION,
        is_monophonic=is_mono,
        audio_suitability_warning=suit_warn
    )

    out_file = TRANSCRIPTION_DIR / f"{audio_id}.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(result.model_dump(), f, indent=2)

    return result

def get_transcription(audio_id: str) -> Optional[TranscriptionResult]:
    out_file = TRANSCRIPTION_DIR / f"{audio_id}.json"
    if not out_file.exists():
        return None
    try:
        with open(out_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Automatically refresh stale transcriptions generated by older pipeline versions
            if data.get("pipeline_version") != PIPELINE_VERSION:
                return transcribe_audio(audio_id)
            return TranscriptionResult(**data)
    except Exception:
        return transcribe_audio(audio_id)
