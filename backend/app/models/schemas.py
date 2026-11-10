from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class AudioInfo(BaseModel):
    id: str
    filename: str
    original_filename: str
    format: str
    duration: float
    sample_rate: int
    channels: int
    file_size: int
    waveform_overview: List[float] = []
    is_processed: bool = False
    original_id: Optional[str] = None

class PreprocessRequest(BaseModel):
    noise_reduction_enabled: bool = False
    noise_reduction_intensity: float = Field(0.5, ge=0.0, le=1.0)
    normalize_enabled: bool = True
    time_range_start: Optional[float] = None
    time_range_end: Optional[float] = None

class TrimRequest(BaseModel):
    start_time: float
    end_time: float

class NoteItem(BaseModel):
    id: str
    midi: int
    note_name: str
    octave: int
    start: float
    end: float
    duration: float
    confidence: float
    frequency: float
    cents_deviation: float = 0.0

class PitchFrame(BaseModel):
    time: float
    frequency: float
    midi: float
    confidence: float

class TranscriptionResult(BaseModel):
    audio_id: str
    notes: List[NoteItem]
    pitch_contour: List[PitchFrame] = []
    bpm: float
    key_estimate: str
    scale_estimate: str
    duration: float
    confidence_overall: float
    transcription_engine: str = "Spotify Basic Pitch / pYIN Hybrid"

class CorrectionRequest(BaseModel):
    pitch_center_strength: float = Field(0.5, ge=0.0, le=1.0)
    pitch_variation_reduction: float = Field(0.5, ge=0.0, le=1.0)

class NoteScore(BaseModel):
    note_id: str
    target_note: str
    target_midi: int
    start: float
    end: float
    user_avg_cents_error: float
    user_detected_midi: Optional[float] = None
    is_hit: bool
    score: float

class EvaluationRequest(BaseModel):
    reference_notes: List[NoteItem]
    performance_pitches: List[PitchFrame]
    tolerance_cents: float = 50.0

class EvaluationResponse(BaseModel):
    pitch_accuracy: float
    timing_accuracy: float
    sequence_accuracy: float
    overall_score: float
    feedback: List[str]
    note_scores: List[NoteScore] = []
