export interface AudioInfo {
  id: string;
  filename: string;
  original_filename: string;
  format: string;
  duration: number;
  sample_rate: number;
  channels: number;
  file_size: number;
  waveform_overview: number[];
  is_processed: boolean;
  original_id?: string | null;
}

export interface NoteItem {
  id: string;
  midi: number;
  note_name: string;
  octave: number;
  start: number;
  end: number;
  duration: number;
  confidence: number;
  frequency: number;
  cents_deviation: number;
}

export interface PitchFrame {
  time: number;
  frequency: number;
  midi: number;
  confidence: number;
}

export interface TranscriptionResult {
  audio_id: string;
  notes: NoteItem[];
  pitch_contour: PitchFrame[];
  bpm: number;
  key_estimate: string;
  scale_estimate: string;
  duration: number;
  confidence_overall: number;
  transcription_engine: string;
}

export interface PreprocessOptions {
  noise_reduction_enabled: boolean;
  noise_reduction_intensity: number;
  normalize_enabled: boolean;
  time_range_start?: number;
  time_range_end?: number;
}

export interface CorrectionOptions {
  pitch_center_strength: number;
  pitch_variation_reduction: number;
}

export interface NoteScore {
  note_id: string;
  target_note: string;
  target_midi: number;
  start: number;
  end: number;
  user_avg_cents_error: number;
  user_detected_midi: number | null;
  is_hit: boolean;
  score: number;
}

export interface EvaluationResponse {
  pitch_accuracy: number;
  timing_accuracy: number;
  sequence_accuracy: number;
  overall_score: number;
  feedback: string[];
  note_scores: NoteScore[];
}

export interface PerformanceRecord {
  id: string;
  timestamp: string;
  overall_score: number;
  pitch_accuracy: number;
  timing_accuracy: number;
  sequence_accuracy: number;
  hit_count: number;
  total_notes: number;
  feedback: string[];
}

export interface PracticeConfigSettings {
  mode: 'full' | 'note';
  target_note_name?: string;
  target_midi?: number;
  playback_speed: number;
  transpose_semitones: number;
  tolerance_cents: number;
}

export interface PracticeConfiguration {
  config_id: string;
  label: string;
  settings: PracticeConfigSettings;
  created_at: string;
  updated_at: string;
  sessions: PerformanceRecord[];
  first_score: number;
  latest_score: number;
  best_score: number;
}

export interface HistoryTrack {
  track_id: string;
  filename: string;
  duration: number;
  created_at: string;
  last_practiced_at: string;
  configurations: PracticeConfiguration[];
}
