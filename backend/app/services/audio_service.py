import os
import uuid
import json
from pathlib import Path
from typing import Optional, Tuple, Dict, Any, List
import numpy as np
import soundfile as sf

from ..config import UPLOADS_DIR, PROCESSED_DIR, SUPPORTED_EXTENSIONS
from ..models.schemas import AudioInfo
from .dsp_utils import load_audio

METADATA_DIR = UPLOADS_DIR / "metadata"
METADATA_DIR.mkdir(parents=True, exist_ok=True)

def generate_waveform_peaks(y: np.ndarray, num_points: int = 200) -> List[float]:
    if len(y) == 0:
        return []
    if y.ndim > 1:
        y = np.mean(y, axis=1)
    
    abs_y = np.abs(y)
    chunk_size = max(1, len(abs_y) // num_points)
    peaks = []
    for i in range(0, len(abs_y), chunk_size):
        chunk = abs_y[i:i + chunk_size]
        if len(chunk) > 0:
            peaks.append(float(np.max(chunk)))
    
    max_val = max(peaks) if peaks and max(peaks) > 0 else 1.0
    return [round(p / max_val, 3) for p in peaks[:num_points]]

def save_uploaded_file(contents: bytes, filename: str) -> AudioInfo:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported audio format '{ext}'. Supported: {', '.join(SUPPORTED_EXTENSIONS)}")

    audio_id = str(uuid.uuid4())
    stored_filename = f"{audio_id}{ext}"
    target_path = UPLOADS_DIR / stored_filename

    with open(target_path, "wb") as f:
        f.write(contents)

    # Read audio with soundfile
    try:
        info = sf.info(str(target_path))
        duration = float(info.duration)
        sr = int(info.samplerate)
        channels = int(info.channels)
        y, _, _ = load_audio(str(target_path), target_sr=sr)
    except Exception as e:
        y, sr, duration = load_audio(str(target_path), target_sr=22050)
        channels = 1

    peaks = generate_waveform_peaks(y, num_points=200)

    audio_info = AudioInfo(
        id=audio_id,
        filename=stored_filename,
        original_filename=filename,
        format=ext.lstrip("."),
        duration=round(duration, 2),
        sample_rate=int(sr),
        channels=channels,
        file_size=len(contents),
        waveform_overview=peaks,
        is_processed=False
    )

    meta_path = METADATA_DIR / f"{audio_id}.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(audio_info.model_dump(), f, indent=2)

    return audio_info

def get_audio_info(audio_id: str) -> Optional[AudioInfo]:
    meta_path = METADATA_DIR / f"{audio_id}.json"
    if not meta_path.exists():
        proc_meta_path = PROCESSED_DIR / f"{audio_id}.json"
        if proc_meta_path.exists():
            with open(proc_meta_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return AudioInfo(**data)
        return None
    with open(meta_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        return AudioInfo(**data)

def get_audio_filepath(audio_id: str) -> Optional[Path]:
    for p in UPLOADS_DIR.glob(f"{audio_id}.*"):
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS:
            return p
    for p in PROCESSED_DIR.glob(f"{audio_id}.*"):
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS:
            return p
    return None

def list_all_audios() -> List[AudioInfo]:
    audios = []
    for meta_file in sorted(METADATA_DIR.glob("*.json"), key=os.path.getmtime, reverse=True):
        try:
            with open(meta_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                audios.append(AudioInfo(**data))
        except Exception:
            continue
    return audios
