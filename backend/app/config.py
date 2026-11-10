import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = BASE_DIR / "storage"
UPLOADS_DIR = STORAGE_DIR / "uploads"
PROCESSED_DIR = STORAGE_DIR / "processed"
EXPORTS_DIR = STORAGE_DIR / "exports"

for d in [STORAGE_DIR, UPLOADS_DIR, PROCESSED_DIR, EXPORTS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg"}
DEFAULT_SAMPLE_RATE = 22050
