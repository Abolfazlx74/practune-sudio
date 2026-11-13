import type { AudioInfo, TranscriptionResult, PreprocessOptions, CorrectionOptions, EvaluationResponse, NoteItem, PitchFrame } from '../types';

const API_BASE = '/api';

export async function uploadAudio(file: File): Promise<AudioInfo> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/audio/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(err.detail || 'Upload failed');
  }

  return res.json();
}

export async function getAudioInfo(audioId: string): Promise<AudioInfo> {
  const res = await fetch(`${API_BASE}/audio/${audioId}`);
  if (!res.ok) throw new Error('Failed to get audio info');
  return res.json();
}

export function getAudioFileUrl(audioId: string): string {
  return `${API_BASE}/audio/${audioId}/file`;
}

export async function preprocessAudio(audioId: string, options: PreprocessOptions): Promise<AudioInfo> {
  const res = await fetch(`${API_BASE}/audio/${audioId}/preprocess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Preprocessing failed' }));
    throw new Error(err.detail || 'Preprocessing failed');
  }

  return res.json();
}

export async function trimAudio(audioId: string, startTime: number, endTime: number): Promise<AudioInfo> {
  const res = await fetch(`${API_BASE}/audio/${audioId}/trim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_time: startTime, end_time: endTime }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Audio trimming failed' }));
    throw new Error(err.detail || 'Audio trimming failed');
  }

  return res.json();
}

export async function transcribeAudio(audioId: string): Promise<TranscriptionResult> {
  const res = await fetch(`${API_BASE}/audio/${audioId}/transcribe`, {
    method: 'POST',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Transcription failed' }));
    throw new Error(err.detail || 'Transcription failed');
  }

  return res.json();
}

export async function getTranscription(audioId: string): Promise<TranscriptionResult> {
  const res = await fetch(`${API_BASE}/audio/${audioId}/transcription`);
  if (!res.ok) throw new Error('Transcription not found');
  return res.json();
}

export async function correctPitch(audioId: string, options: CorrectionOptions): Promise<TranscriptionResult> {
  const res = await fetch(`${API_BASE}/audio/${audioId}/correct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Pitch correction failed' }));
    throw new Error(err.detail || 'Pitch correction failed');
  }

  return res.json();
}

export async function evaluatePractice(
  referenceNotes: NoteItem[],
  performancePitches: PitchFrame[],
  toleranceCents = 50.0,
  studioType: 'vocal' | 'instrument' = 'vocal'
): Promise<EvaluationResponse> {
  const res = await fetch(`${API_BASE}/practice/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reference_notes: referenceNotes,
      performance_pitches: performancePitches,
      tolerance_cents: toleranceCents,
      studio_type: studioType,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Practice evaluation failed' }));
    throw new Error(err.detail || 'Practice evaluation failed');
  }

  return res.json();
}

export async function evaluateRecordedPerformance(
  audioId: string,
  audioFile: File,
  toleranceCents = 50.0,
  transposeSemitones = 0,
  studioType: 'vocal' | 'instrument' = 'vocal'
): Promise<EvaluationResponse> {
  const formData = new FormData();
  formData.append('audio_id', audioId);
  formData.append('file', audioFile);
  formData.append('tolerance_cents', toleranceCents.toString());
  formData.append('transpose_semitones', transposeSemitones.toString());
  formData.append('studio_type', studioType);

  const res = await fetch(`${API_BASE}/practice/evaluate-recording`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Recorded audio evaluation failed' }));
    throw new Error(err.detail || 'Recorded audio evaluation failed');
  }

  return res.json();
}

export async function listRecentAudios(): Promise<AudioInfo[]> {
  const res = await fetch(`${API_BASE}/audio/list`);
  if (!res.ok) return [];
  return res.json();
}
