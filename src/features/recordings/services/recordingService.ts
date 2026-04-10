/**
 * Recording Service — Handle recording CRUD, export, and sync operations
 * Extracted from App.tsx to improve testability and reusability
 */

import { format } from 'date-fns';
import * as db from '../../../lib/storage/db';

export interface Recording {
  id: string;
  blob: Blob;
  url: string;
  timestamp: Date;
  triggerWord: string;
  duration: number;
  confidence: 'Strong' | 'Good' | 'Weak';
  transcript: string;
  voteScore: number;
  matchVariant?: string;
}

export interface StoredRecording
  extends Omit<Recording, 'url' | 'timestamp'> {
  timestamp: string;
  audioBase64?: string;  // Legacy fallback
}

export interface LegacyStoredRecording {
  id: string;
  timestamp?: string;
  triggerWord?: string;
  duration?: number;
  confidence?: 'Strong' | 'Good' | 'Weak';
  transcript?: string;
  voteScore?: number;
  matchVariant?: string;
  blob?: Blob;
  audioBase64?: string;
  url?: string;
}

export interface KeywordStat {
  word: string;
  count: number;
  lastSeen?: Date;
  avgConfidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization Helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function toStoredRecording(recording: Recording): Promise<StoredRecording> {
  return {
    id: recording.id,
    blob: recording.blob,
    timestamp: recording.timestamp.toISOString(),
    triggerWord: recording.triggerWord,
    duration: recording.duration,
    confidence: recording.confidence,
    transcript: recording.transcript,
    voteScore: recording.voteScore,
    matchVariant: recording.matchVariant,
  };
}

export async function hydrateStoredRecordings(items: StoredRecording[]): Promise<Recording[]> {
  const results: Recording[] = [];
  
  for (const item of items) {
    try {
      let blob = item.blob;
      if (!blob && item.audioBase64) {
        blob = await base64ToBlob(item.audioBase64);
      }
      
      if (!blob) {
        console.warn('[recordingService] Skipping recording without blob or audioBase64:', item.id);
        continue;
      }
      
      results.push({
        id: item.id,
        blob,
        url: URL.createObjectURL(blob),
        timestamp: new Date(item.timestamp),
        triggerWord: item.triggerWord,
        duration: item.duration,
        confidence: item.confidence,
        transcript: item.transcript,
        voteScore: item.voteScore,
        matchVariant: item.matchVariant,
      });
    } catch (error) {
      console.warn('[recordingService] Failed to hydrate recording:', item.id, error);
    }
  }
  
  return results;
}

export interface NormalizedRecordingsResult {
  hydrated: Recording[];
  migrated: StoredRecording[];
  deletedIds: string[];
}

export async function normalizeStoredRecordings(
  items: LegacyStoredRecording[]
): Promise<NormalizedRecordingsResult> {
  const hydrated: Recording[] = [];
  const migrated: StoredRecording[] = [];
  const deletedIds: string[] = [];

  for (const item of items) {
    let blob: Blob | null = item.blob instanceof Blob ? item.blob : null;

    if (!blob && item.audioBase64) {
      try {
        blob = await base64ToBlob(item.audioBase64);
      } catch (error) {
        console.warn('[recordingService] Failed to recover recording from base64:', item.id, error);
      }
    }

    if (!blob) {
      deletedIds.push(item.id);
      continue;
    }

    try {
      const stored: StoredRecording = {
        id: item.id,
        blob,
        timestamp: item.timestamp || new Date(0).toISOString(),
        triggerWord: item.triggerWord || 'unknown',
        duration: typeof item.duration === 'number' ? item.duration : 0,
        confidence: item.confidence || 'Weak',
        transcript: item.transcript || '',
        voteScore: typeof item.voteScore === 'number' ? item.voteScore : 0,
        matchVariant: item.matchVariant,
      };

      migrated.push(stored);
      hydrated.push({
        ...stored,
        blob,
        url: URL.createObjectURL(blob),
        timestamp: new Date(stored.timestamp),
      } as unknown as Recording);
    } catch (error) {
      console.warn('[recordingService] Failed to normalize recording:', item.id, error);
      deletedIds.push(item.id);
    }
  }

  return { hydrated, migrated, deletedIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// Blob Conversion
// ─────────────────────────────────────────────────────────────────────────────

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function base64ToBlob(b64: string): Promise<Blob> {
  const response = await fetch(b64);
  return response.blob();
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording Save & Sync
// ─────────────────────────────────────────────────────────────────────────────

export async function saveRecordingToDatabase(recording: Recording): Promise<void> {
  try {
    // Convert blob to base64 for IndexedDB storage (Blobs are not serializable)
    const stored = await toStoredRecording(recording);
    await db.put(db.STORES.RECORDINGS, stored);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error('[recordingService] Failed to save recording to IndexedDB:', errMsg);
    throw new Error(`Database save failed: ${errMsg}`);
  }
}

export async function syncRecordingToServer(
  recording: Recording
): Promise<boolean> {
  try {
    const base64 = await blobToBase64(recording.blob);
    const response = await fetch('/api/recordings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: recording.id,
        triggerWord: recording.triggerWord,
        duration: recording.duration,
        timestamp: recording.timestamp.toISOString(),
        audioBase64: base64,
        size: recording.blob.size,
        confidence: recording.confidence,
        transcript: recording.transcript,
        voteScore: recording.voteScore,
        matchVariant: recording.matchVariant,
      }),
    });
    return response.ok;
  } catch (e) {
    console.warn('Failed to sync recording to server:', e);
    return false;
  }
}

export async function queueRecordingForSync(recording: Recording): Promise<void> {
  try {
    const base64 = await blobToBase64(recording.blob);
    await db.queueRecordingForSync({
      id: recording.id,
      triggerWord: recording.triggerWord,
      duration: recording.duration,
      timestamp: recording.timestamp.toISOString(),
      audioBase64: base64,
      size: recording.blob.size,
      confidence: recording.confidence,
      transcript: recording.transcript,
      voteScore: recording.voteScore,
      matchVariant: recording.matchVariant,
    });
  } catch (e) {
    console.warn('Failed to queue recording for sync:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording Deletion
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteRecordingFromDatabase(id: string): Promise<void> {
  try {
    await db.delete_(db.STORES.RECORDINGS, id);
  } catch (e) {
    console.warn('Failed to delete recording from database:', e);
  }
}

export async function deleteRecordingFromServer(id: string): Promise<void> {
  try {
    await fetch(`/api/recordings/${id}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('Failed to delete recording from server:', e);
  }
}

export async function removeRecordingFromSyncQueue(id: string): Promise<void> {
  try {
    await db.removeFromSyncQueue(id);
  } catch (e) {
    console.warn('Failed to remove recording from sync queue:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export to ZIP
// ─────────────────────────────────────────────────────────────────────────────

export async function exportRecordingsAsZip(
  recordings: Recording[],
  filename?: string
): Promise<void> {
  if (!recordings.length) {
    throw new Error('No recordings to export');
  }

  const [{ default: JSZip }, { saveAs }] = await Promise.all([
    import('jszip'),
    import('file-saver'),
  ]);

  const zip = new JSZip();
  let csv =
    'ID,Keyword,Duration(s),Timestamp,Confidence,VoteScore,MatchVariant,Transcript\n';

  for (const rec of recordings) {
    // Add WAV file
    zip.file(`ad_${rec.triggerWord}_${rec.id}.wav`, rec.blob);

    // Add CSV row
    csv += `${rec.id},"${rec.triggerWord}",${rec.duration.toFixed(
      1
    )},${rec.timestamp.toISOString()},${rec.confidence},${rec.voteScore.toFixed(
      2
    )},"${rec.matchVariant || ''}","${(rec.transcript || '').replace(/"/g, '""')}"\n`;
  }

  zip.file('metadata.csv', csv);
  const content = await zip.generateAsync({ type: 'blob' });
  const finalFilename = filename || `ad_captures_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.zip`;
  
  saveAs(content, finalFilename);
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtering & Sorting
// ─────────────────────────────────────────────────────────────────────────────

export type SortOrder = 'time' | 'keyword' | 'confidence';

export interface FilterOptions {
  searchQuery?: string;
  keyword?: string;
  confidence?: 'Strong' | 'Good' | 'Weak';
  sortBy?: SortOrder;
}

export function filterAndSortRecordings(
  recordings: Recording[],
  options: FilterOptions = {}
): Recording[] {
  let filtered = [...recordings];

  // Text search
  if (options.searchQuery) {
    const query = options.searchQuery.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.triggerWord.toLowerCase().includes(query) ||
        r.transcript.toLowerCase().includes(query) ||
        r.matchVariant?.toLowerCase().includes(query) ||
        r.id.includes(query)
    );
  }

  // Keyword filter
  if (options.keyword) {
    filtered = filtered.filter((r) => r.triggerWord === options.keyword);
  }

  // Confidence filter
  if (options.confidence) {
    filtered = filtered.filter((r) => r.confidence === options.confidence);
  }

  // Sorting
  const sortBy = options.sortBy || 'time';
  filtered.sort((a, b) => {
    if (sortBy === 'time') {
      const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
      const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
      return bTime - aTime;
    } else if (sortBy === 'keyword') {
      return a.triggerWord.localeCompare(b.triggerWord);
    } else if (sortBy === 'confidence') {
      const confValue = {
        Strong: 3,
        Good: 2,
        Weak: 1,
      };
      return confValue[b.confidence] - confValue[a.confidence];
    }
    return 0;
  });

  return filtered;
}

// ─────────────────────────────────────────────────────────────────────────────
// Statistics
// ─────────────────────────────────────────────────────────────────────────────

export function buildKeywordStats(recordings: Recording[]): Record<string, KeywordStat> {
  const stats: Record<string, KeywordStat> = {};

  for (const rec of recordings) {
    const confidenceScore =
      rec.confidence === 'Strong' ? 1 : rec.confidence === 'Good' ? 0.67 : 0.33;

    const existing = stats[rec.triggerWord] || {
      word: rec.triggerWord,
      count: 0,
      avgConfidence: 0,
      lastSeen: undefined,
    };

    const nextCount = existing.count + 1;
    stats[rec.triggerWord] = {
      word: rec.triggerWord,
      count: nextCount,
      lastSeen:
        !existing.lastSeen || rec.timestamp > existing.lastSeen
          ? rec.timestamp
          : existing.lastSeen,
      avgConfidence:
        (existing.avgConfidence * existing.count + confidenceScore) / nextCount,
    };
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Deletion
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteRecordingsBulk(recordingIds: string[]): Promise<void> {
  // Cleanup URLs first
  const recordings = recordingIds;
  for (const id of recordings) {
    try {
      await deleteRecordingFromDatabase(id);
      await removeRecordingFromSyncQueue(id);
      // Server delete is best-effort
      try {
        await deleteRecordingFromServer(id);
      } catch {}
    } catch (e) {
      console.warn(`Failed to delete recording ${id}:`, e);
    }
  }
}
