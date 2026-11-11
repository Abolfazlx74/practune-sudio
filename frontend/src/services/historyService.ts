import type {
  AudioInfo,
  EvaluationResponse,
  HistoryTrack,
  PerformanceRecord,
  PracticeConfigSettings,
  PracticeConfiguration,
} from '../types';

const STORAGE_KEY = 'practune_performance_history_v1';

export function generateConfigId(settings: PracticeConfigSettings): string {
  const modeKey =
    settings.mode === 'note'
      ? `note_${settings.target_note_name || settings.target_midi || 'target'}`
      : 'full';
  const speedKey = `${settings.playback_speed.toFixed(2)}x`;
  const transposeKey = `${settings.transpose_semitones >= 0 ? '+' : ''}${settings.transpose_semitones}st`;
  const tolKey = `${Math.round(settings.tolerance_cents)}c`;
  return `${modeKey}_${speedKey}_${transposeKey}_${tolKey}`;
}

export function generateConfigLabel(settings: PracticeConfigSettings): string {
  const modeText =
    settings.mode === 'note'
      ? `Target ${settings.target_note_name || 'Note'}`
      : 'Full Song';
  const speedText = `${Math.round(settings.playback_speed * 100)}% Speed`;
  const transposeText =
    settings.transpose_semitones === 0
      ? 'Original Key'
      : `Key ${settings.transpose_semitones > 0 ? '+' : ''}${settings.transpose_semitones} st`;
  return `${modeText} • ${speedText} • ${transposeText}`;
}

export function getHistory(): HistoryTrack[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to load performance history from localStorage:', err);
    return [];
  }
}

export function saveHistory(history: HistoryTrack[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (err) {
    console.error('Failed to save performance history to localStorage:', err);
  }
}

/**
 * Smart Duplicate Detection & Session Recording:
 * - If the track does not exist, create it.
 * - If the configuration already exists under this track, append the session to it (NO duplicate config).
 * - If the configuration is new, create a separate configuration under the track.
 */
export function recordPracticeSession(
  audio: AudioInfo | { id: string; filename: string; duration: number },
  settings: PracticeConfigSettings,
  evaluation: EvaluationResponse
): { track: HistoryTrack; config: PracticeConfiguration; record: PerformanceRecord } {
  const history = getHistory();
  const now = new Date().toISOString();

  // 1. Calculate hit count
  const hitCount = evaluation.note_scores
    ? evaluation.note_scores.filter((n) => n.is_hit).length
    : 0;
  const totalNotes = evaluation.note_scores ? evaluation.note_scores.length : 0;

  // 2. Build Performance Record
  const newRecord: PerformanceRecord = {
    id: `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: now,
    overall_score: Math.round(evaluation.overall_score),
    pitch_accuracy: Math.round(evaluation.pitch_accuracy),
    timing_accuracy: Math.round(evaluation.timing_accuracy),
    sequence_accuracy: Math.round(evaluation.sequence_accuracy),
    hit_count: hitCount,
    total_notes: totalNotes,
    feedback: evaluation.feedback ? evaluation.feedback.slice(0, 3) : [],
  };

  const configId = generateConfigId(settings);
  const configLabel = generateConfigLabel(settings);

  // 3. Find or Create Track (unique per audio ID or identical filename + duration)
  let trackIndex = history.findIndex(
    (t) =>
      t.track_id === audio.id ||
      (t.filename === audio.filename && Math.abs(t.duration - audio.duration) < 0.2)
  );

  let track: HistoryTrack;
  if (trackIndex >= 0) {
    track = history[trackIndex];
    track.last_practiced_at = now;
    // Update track_id in case this is a re-uploaded audio instance
    track.track_id = audio.id;
  } else {
    track = {
      track_id: audio.id,
      filename: audio.filename,
      duration: audio.duration,
      created_at: now,
      last_practiced_at: now,
      configurations: [],
    };
    history.unshift(track);
    trackIndex = 0;
  }

  // 4. Find or Create Configuration under this track
  let config = track.configurations.find((c) => c.config_id === configId);

  if (config) {
    // Existing configuration -> Update performance records without duplicate configuration
    config.sessions.push(newRecord);
    config.updated_at = now;
    config.latest_score = newRecord.overall_score;
    config.best_score = Math.max(config.best_score, newRecord.overall_score);
  } else {
    // New configuration under this track
    config = {
      config_id: configId,
      label: configLabel,
      settings: { ...settings },
      created_at: now,
      updated_at: now,
      sessions: [newRecord],
      first_score: newRecord.overall_score,
      latest_score: newRecord.overall_score,
      best_score: newRecord.overall_score,
    };
    track.configurations.unshift(config);
  }

  saveHistory(history);
  return { track, config, record: newRecord };
}

export function deleteTrack(trackId: string): HistoryTrack[] {
  const history = getHistory().filter((t) => t.track_id !== trackId);
  saveHistory(history);
  return history;
}

export function deleteConfiguration(trackId: string, configId: string): HistoryTrack[] {
  const history = getHistory();
  const track = history.find((t) => t.track_id === trackId);
  if (track) {
    track.configurations = track.configurations.filter((c) => c.config_id !== configId);
    // If no configurations left, keep track or remove if preferred
    if (track.configurations.length === 0) {
      return deleteTrack(trackId);
    }
    saveHistory(history);
  }
  return history;
}

export function deleteSessionRecord(
  trackId: string,
  configId: string,
  recordId: string
): HistoryTrack[] {
  const history = getHistory();
  const track = history.find((t) => t.track_id === trackId);
  if (!track) return history;

  const config = track.configurations.find((c) => c.config_id === configId);
  if (!config) return history;

  config.sessions = config.sessions.filter((s) => s.id !== recordId);

  if (config.sessions.length === 0) {
    return deleteConfiguration(trackId, configId);
  }

  // Recalculate summary metrics
  config.first_score = config.sessions[0].overall_score;
  config.latest_score = config.sessions[config.sessions.length - 1].overall_score;
  config.best_score = Math.max(...config.sessions.map((s) => s.overall_score));

  saveHistory(history);
  return history;
}

export function clearAllHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function relinkTrackId(oldTrackId: string, newAudioInfo: AudioInfo): HistoryTrack[] {
  const history = getHistory();
  const track = history.find((t) => t.track_id === oldTrackId);
  if (track) {
    track.track_id = newAudioInfo.id;
    track.filename = newAudioInfo.filename;
    track.duration = newAudioInfo.duration;
    saveHistory(history);
  }
  return history;
}
