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

class TransitionRegion(BaseModel):
    start: float
    end: float
    from_note: Optional[str] = None
    to_note: Optional[str] = None
    from_midi: Optional[float] = None
    to_midi: Optional[float] = None
    transition_type: str = "slide"  # slide, attack, release

class VibratoInfo(BaseModel):
    note_id: str
    rate_hz: float = 0.0  # typical 4-7 Hz
    extent_cents: float = 0.0  # peak-to-peak depth in cents
    has_vibrato: bool = False

class TranscriptionResult(BaseModel):
    audio_id: str
    notes: List[NoteItem]
    pitch_contour: List[PitchFrame] = []
    transitions: List[TransitionRegion] = []
    vibratos: List[VibratoInfo] = []
    bpm: float
    key_estimate: str
    scale_estimate: str
    duration: float
    confidence_overall: float
    transcription_engine: str = "DSP YIN & Onset Tracker"
    pipeline_version: Optional[str] = "2.2.0"
    is_monophonic: Optional[bool] = True
    audio_suitability_warning: Optional[str] = None

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
    transitions: Optional[List[TransitionRegion]] = []
    evaluation_mode: str = "live"  # "live" or "imported"
    studio_type: str = "vocal"  # "vocal" or "instrument"
    practice_mode: str = "full"  # "full" or "note"

class EvaluationResponse(BaseModel):
    pitch_accuracy: float
    timing_accuracy: float
    sequence_accuracy: float
    note_coverage: float = 100.0
    overall_score: float
    feedback: List[str]
    note_scores: List[NoteScore] = []
    # Performance contour for imported performance visualization
    performance_contour: Optional[List[PitchFrame]] = None
    # Diagnostic / transparency fields
    detected_reference_notes_count: int = 0
    detected_live_notes_count: int = 0
    missed_notes_count: int = 0
    extra_notes_count: int = 0
    alignment_offset_ms: float = 0.0
    avg_cents_error: float = 0.0
    evaluation_mode: str = "live"  # "live" or "imported"
    studio_type: str = "vocal"  # "vocal" or "instrument"
