import type {
  AudioInfo,
  EvaluationResponse,
  PerformanceRecord,
  PracticeConfigSettings,
  PracticeConfiguration,
  Project,
  TranscriptionResult,
  WorkspaceSettings,
} from '../types';
import { generateConfigId, generateConfigLabel } from './historyService';

const DB_NAME = 'practune_studio_db';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_AUDIO_ASSETS = 'audio_assets';
const CACHE_KEY = 'practune_projects_cache_v2';
const LEGACY_STORAGE_KEY = 'practune_performance_history_v1';

// Open / initialize IndexedDB
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported in this environment'));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO_ASSETS)) {
        db.createObjectStore(STORE_AUDIO_ASSETS, { keyPath: 'assetId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Memory / localStorage cache sync
function readCache(): Project[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed reading projects cache:', err);
    return [];
  }
}

function writeCache(projects: Project[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(projects));
  } catch (err) {
    console.error('Failed writing projects cache:', err);
  }
}

// Migrate legacy history into projects on initial startup
let isMigrationDone = false;
async function checkAndMigrateLegacy() {
  if (isMigrationDone) return;
  isMigrationDone = true;

  try {
    const existingProjects = readCache();
    if (existingProjects.length > 0) return;

    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyRaw) return;

    const legacyHistory = JSON.parse(legacyRaw);
    if (!Array.isArray(legacyHistory) || legacyHistory.length === 0) return;

    const migrated: Project[] = legacyHistory.map((track) => {
      const cleanName = track.filename.replace(/\.[^/.]+$/, '');
      const assetId = `asset_${track.track_id}`;
      return {
        id: `proj_${track.track_id}`,
        name: cleanName || 'Practice Session',
        assetId,
        audioInfo: {
          id: track.track_id,
          filename: track.filename,
          original_filename: track.filename,
          format: 'mp3',
          duration: track.duration,
          sample_rate: 22050,
          channels: 1,
          file_size: 1024 * 1024,
          waveform_overview: [],
          is_processed: false,
        },
        transcription: null,
        workspaceSettings: {
          playbackRate: 1.0,
          rangeStart: 0,
          rangeEnd: track.duration,
        },
        practiceSettings: track.configurations[0]?.settings || {
          mode: 'full',
          playback_speed: 1.0,
          transpose_semitones: 0,
          tolerance_cents: 50.0,
        },
        configurations: track.configurations || [],
        createdAt: track.created_at || new Date().toISOString(),
        updatedAt: track.last_practiced_at || new Date().toISOString(),
        lastOpenedAt: track.last_practiced_at || new Date().toISOString(),
      };
    });

    writeCache(migrated);
    const db = await openDB().catch(() => null);
    if (db) {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      for (const p of migrated) {
        store.put(p);
      }
    }
  } catch (err) {
    console.warn('Legacy history migration skipped:', err);
  }
}

// Generate asset identifier based on audio properties
export function generateAssetId(filename: string, sizeOrDuration: number): string {
  const clean = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `asset_${clean}_${Math.round(sizeOrDuration)}`;
}

// Save audio binary blob in IndexedDB
export async function storeAudioBlob(
  assetId: string,
  blob: Blob,
  metadata?: { filename: string; mimeType: string }
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_AUDIO_ASSETS, 'readwrite');
    const store = tx.objectStore(STORE_AUDIO_ASSETS);
    store.put({
      assetId,
      blob,
      filename: metadata?.filename || 'audio.wav',
      mimeType: metadata?.mimeType || blob.type || 'audio/wav',
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Failed to store audio blob in IndexedDB:', err);
  }
}

// Retrieve audio binary blob from IndexedDB
export async function getAudioBlob(assetId: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_AUDIO_ASSETS, 'readonly');
      const store = tx.objectStore(STORE_AUDIO_ASSETS);
      const req = store.get(assetId);
      req.onsuccess = () => {
        if (req.result && req.result.blob) {
          resolve(req.result.blob);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

// Get all saved projects (sorted by lastOpenedAt descending)
export async function getAllProjects(): Promise<Project[]> {
  await checkAndMigrateLegacy();

  let projects = readCache();

  try {
    const db = await openDB();
    const dbProjects = await new Promise<Project[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    if (dbProjects && dbProjects.length > 0) {
      projects = dbProjects;
      writeCache(projects);
    }
  } catch (err) {
    // If IndexedDB fails, rely on cached projects
  }

  return projects.sort(
    (a, b) => new Date(b.lastOpenedAt || b.updatedAt).getTime() - new Date(a.lastOpenedAt || a.updatedAt).getTime()
  );
}

// Get top N recent projects for Dashboard
export async function getRecentProjects(limit = 3): Promise<Project[]> {
  const all = await getAllProjects();
  return all.slice(0, limit);
}

// Get single project by ID
export async function getProject(id: string): Promise<Project | null> {
  const all = await getAllProjects();
  return all.find((p) => p.id === id) || null;
}

// Save Project (Updates existing project, or adds new if ID not found)
export async function saveProject(project: Project): Promise<Project> {
  const now = new Date().toISOString();
  const updatedProject: Project = {
    ...project,
    updatedAt: now,
    lastOpenedAt: now,
  };

  const all = await getAllProjects();
  const index = all.findIndex((p) => p.id === project.id);
  if (index >= 0) {
    all[index] = updatedProject;
  } else {
    all.unshift(updatedProject);
  }

  writeCache(all);

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    const store = tx.objectStore(STORE_PROJECTS);
    store.put(updatedProject);
  } catch (err) {
    console.error('Failed saving project to IndexedDB:', err);
  }

  return updatedProject;
}

// Save As: clones project state into a new independent project
export async function saveProjectAs(baseProject: Project, newName: string): Promise<Project> {
  const now = new Date().toISOString();
  const newId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Deep clone configurations with new IDs
  const clonedConfigs: PracticeConfiguration[] = (baseProject.configurations || []).map((c) => ({
    ...c,
    config_id: `${c.config_id}_copy_${Math.random().toString(36).substring(2, 5)}`,
    created_at: now,
    updated_at: now,
    sessions: c.sessions.map((s) => ({ ...s, id: `sess_${Date.now()}_${Math.random().toString(36).substring(2, 6)}` })),
  }));

  const newProject: Project = {
    ...baseProject,
    id: newId,
    name: newName.trim(),
    configurations: clonedConfigs,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };

  return await saveProject(newProject);
}

// Rename Project
export async function renameProject(id: string, newName: string): Promise<Project | null> {
  const p = await getProject(id);
  if (!p) return null;
  p.name = newName.trim();
  p.updatedAt = new Date().toISOString();
  return await saveProject(p);
}

// Delete Project (with audio asset reference management)
export async function deleteProject(id: string): Promise<void> {
  const all = await getAllProjects();
  const target = all.find((p) => p.id === id);
  const remaining = all.filter((p) => p.id !== id);
  writeCache(remaining);

  try {
    const db = await openDB();
    const tx = db.transaction([STORE_PROJECTS, STORE_AUDIO_ASSETS], 'readwrite');
    tx.objectStore(STORE_PROJECTS).delete(id);

    // If no remaining project references the target's assetId, delete the audio blob
    if (target && target.assetId) {
      const isAssetStillReferenced = remaining.some((p) => p.assetId === target.assetId);
      if (!isAssetStillReferenced) {
        tx.objectStore(STORE_AUDIO_ASSETS).delete(target.assetId);
      }
    }
  } catch (err) {
    console.error('Failed deleting project from IndexedDB:', err);
  }
}

// Clear all projects
export async function clearAllProjects(): Promise<void> {
  writeCache([]);
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);

  try {
    const db = await openDB();
    const tx = db.transaction([STORE_PROJECTS, STORE_AUDIO_ASSETS], 'readwrite');
    tx.objectStore(STORE_PROJECTS).clear();
    tx.objectStore(STORE_AUDIO_ASSETS).clear();
  } catch (err) {
    console.error('Failed clearing IndexedDB stores:', err);
  }
}

// Re-link project's audio if missing
export async function relinkProjectAudio(
  projectId: string,
  newAudioInfo: AudioInfo,
  blob?: Blob
): Promise<Project | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  const newAssetId = generateAssetId(newAudioInfo.filename, newAudioInfo.file_size || newAudioInfo.duration);
  project.assetId = newAssetId;
  project.audioInfo = newAudioInfo;
  project.updatedAt = new Date().toISOString();

  if (blob) {
    await storeAudioBlob(newAssetId, blob, {
      filename: newAudioInfo.filename,
      mimeType: `audio/${newAudioInfo.format}`,
    });
  }

  return await saveProject(project);
}

// Performance Recording Integration: Record performance to project configuration
export async function recordPerformanceToProject(
  projectIdOrAudioId: string,
  audio: AudioInfo | { id: string; filename: string; duration: number },
  settings: PracticeConfigSettings,
  evaluation: EvaluationResponse
): Promise<{ project: Project; record: PerformanceRecord }> {
  const projects = await getAllProjects();
  let project = projects.find((p) => p.id === projectIdOrAudioId || p.audioInfo.id === audio.id);

  const now = new Date().toISOString();
  const hitCount = evaluation.note_scores ? evaluation.note_scores.filter((n) => n.is_hit).length : 0;
  const totalNotes = evaluation.note_scores ? evaluation.note_scores.length : 0;

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

  // If no project exists yet for this audio, initialize one with existing settings
  if (!project) {
    const assetId = generateAssetId(audio.filename, (audio as any).file_size || audio.duration);
    const cleanName = audio.filename.replace(/\.[^/.]+$/, '');
    project = {
      id: `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: cleanName || 'Practice Session',
      assetId,
      audioInfo: {
        id: audio.id,
        filename: audio.filename,
        original_filename: (audio as any).original_filename || audio.filename,
        format: (audio as any).format || 'mp3',
        duration: audio.duration,
        sample_rate: (audio as any).sample_rate || 22050,
        channels: (audio as any).channels || 1,
        file_size: (audio as any).file_size || 1024 * 1024,
        waveform_overview: (audio as any).waveform_overview || [],
        is_processed: (audio as any).is_processed || false,
      },
      transcription: null,
      workspaceSettings: {
        playbackRate: 1.0,
        rangeStart: 0,
        rangeEnd: audio.duration,
      },
      practiceSettings: settings,
      configurations: [],
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
  }

  // Find or create configuration
  let config = project.configurations.find((c) => c.config_id === configId);
  if (config) {
    config.sessions.push(newRecord);
    config.updated_at = now;
    config.latest_score = newRecord.overall_score;
    config.best_score = Math.max(config.best_score, newRecord.overall_score);
  } else {
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
    project.configurations.unshift(config);
  }

  const saved = await saveProject(project);
  return { project: saved, record: newRecord };
}
