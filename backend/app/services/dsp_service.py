import os
import uuid
import json
from pathlib import Path
from typing import Optional, Tuple
import numpy as np
import soundfile as sf
import noisereduce as nr

from ..config import PROCESSED_DIR
from ..models.schemas import AudioInfo, PreprocessRequest
from .audio_service import get_audio_filepath, get_audio_info, generate_waveform_peaks
from .dsp_utils import load_audio

def trim_audio(audio_id: str, start_time: float, end_time: float) -> AudioInfo:
    src_path = get_audio_filepath(audio_id)
    if not src_path or not src_path.exists():
        raise FileNotFoundError(f"Audio {audio_id} not found")

    orig_info = get_audio_info(audio_id)
    y, sr, orig_duration = load_audio(str(src_path), target_sr=22050)

    # Validate bounds
    start_sec = max(0.0, min(start_time, orig_duration))
    end_sec = max(start_sec + 0.1, min(end_time, orig_duration))

    start_samp = int(start_sec * sr)
    end_samp = int(end_sec * sr)
    y_trimmed = y[start_samp:end_samp]

    if len(y_trimmed) == 0:
        raise ValueError("Invalid trim range: resulting slice is empty")

    trimmed_id = f"trim_{uuid.uuid4().hex[:10]}"
    out_filename = f"{trimmed_id}.wav"
    out_path = PROCESSED_DIR / out_filename

    sf.write(str(out_path), y_trimmed, sr, subtype="PCM_16")

    duration = float(len(y_trimmed)) / float(sr)
    peaks = generate_waveform_peaks(y_trimmed, num_points=200)

    trimmed_info = AudioInfo(
        id=trimmed_id,
        filename=out_filename,
        original_filename=f"cut_{orig_info.original_filename if orig_info else 'audio.wav'}",
        format="wav",
        duration=round(duration, 2),
        sample_rate=int(sr),
        channels=1,
        file_size=out_path.stat().st_size,
        waveform_overview=peaks,
        is_processed=True,
        original_id=audio_id
    )

    proc_meta_path = PROCESSED_DIR / f"{trimmed_id}.json"
    with open(proc_meta_path, "w", encoding="utf-8") as f:
        json.dump(trimmed_info.model_dump(), f, indent=2)

    return trimmed_info

def apply_preprocessing(audio_id: str, options: PreprocessRequest) -> AudioInfo:
    src_path = get_audio_filepath(audio_id)
    if not src_path or not src_path.exists():
        raise FileNotFoundError(f"Audio {audio_id} not found")

    orig_info = get_audio_info(audio_id)
    y, sr, _ = load_audio(str(src_path), target_sr=22050)

    # Time range trimming if specified
    if options.time_range_start is not None or options.time_range_end is not None:
        start_samp = int((options.time_range_start or 0.0) * sr)
        end_samp = int((options.time_range_end or (len(y) / sr)) * sr)
        start_samp = max(0, min(start_samp, len(y)))
        end_samp = max(start_samp, min(end_samp, len(y)))
        y = y[start_samp:end_samp]

    # Noise reduction
    if options.noise_reduction_enabled:
        prop = float(np.clip(options.noise_reduction_intensity, 0.1, 1.0))
        y = nr.reduce_noise(y=y, sr=sr, prop_decrease=prop, stationary=True)

    # Loudness / Peak Normalization
    if options.normalize_enabled:
        max_peak = np.max(np.abs(y))
        if max_peak > 1e-6:
            target_peak = 0.89125  # -1.0 dB
            y = y * (target_peak / max_peak)

    # Save to processed directory
    processed_id = f"proc_{uuid.uuid4().hex[:10]}"
    out_filename = f"{processed_id}.wav"
    out_path = PROCESSED_DIR / out_filename

    sf.write(str(out_path), y, sr, subtype="PCM_16")

    duration = float(len(y)) / float(sr)
    peaks = generate_waveform_peaks(y, num_points=200)

    processed_info = AudioInfo(
        id=processed_id,
        filename=out_filename,
        original_filename=f"processed_{orig_info.original_filename if orig_info else 'audio.wav'}",
        format="wav",
        duration=round(duration, 2),
        sample_rate=int(sr),
        channels=1,
        file_size=out_path.stat().st_size,
        waveform_overview=peaks,
        is_processed=True,
        original_id=audio_id
    )

    proc_meta_path = PROCESSED_DIR / f"{processed_id}.json"
    with open(proc_meta_path, "w", encoding="utf-8") as f:
        json.dump(processed_info.model_dump(), f, indent=2)

    return processed_info
