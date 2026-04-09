/**
 * useRecordingManager — Custom hook for recording CRUD, filtering, and export
 * Handles saving, loading, deleting, and exporting recordings
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import * as recordingService from '../services/recordingService';
import * as db from '../../../lib/storage/db';

export type Recording = recordingService.Recording;
export type KeywordStat = recordingService.KeywordStat;

export interface UseRecordingManagerOptions {
  onError?: (error: Error) => void;
  onSuccess?: (message: string) => void;
}

export function useRecordingManager(options: UseRecordingManagerOptions = {}) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedRecordingIds, setSelectedRecordingIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recordingsRef = useRef<Recording[]>([]);

  const handleError = useCallback(
    (e: Error) => {
      setError(e.message);
      options.onError?.(e);
    },
    [options]
  );

  const handleSuccess = useCallback(
    (message: string) => {
      options.onSuccess?.(message);
    },
    [options]
  );

  const revokeRecordingUrls = useCallback((items: Recording[]) => {
    for (const item of items) {
      try {
        URL.revokeObjectURL(item.url);
      } catch {
        // Best-effort cleanup for browser-managed blob URLs.
      }
    }
  }, []);

  useEffect(() => {
    recordingsRef.current = recordings;
  }, [recordings]);

  useEffect(() => {
    return () => {
      revokeRecordingUrls(recordingsRef.current);
    };
  }, [revokeRecordingUrls]);

  // ─────────────────────────────────────────────────────────────────────────
  // Recording CRUD Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add a single recording (from trigger)
   */
  const addRecording = useCallback(
    async (
      blob: Blob,
      triggerWord: string,
      durationSec: number,
      confidence: 'Strong' | 'Good' | 'Weak',
      transcript: string,
      voteScore: number,
      variant: string
    ) => {
      try {
        setIsLoading(true);
        const url = URL.createObjectURL(blob);
        const recording: Recording = {
          id: Math.random().toString(36).slice(2, 11),
          blob,
          url,
          timestamp: new Date(),
          triggerWord,
          duration: durationSec,
          confidence,
          transcript,
          voteScore,
          matchVariant: variant,
        };

        // Save to local DB
        await recordingService.saveRecordingToDatabase(recording);

        // Try to sync to server; queue if fails
        const synced = await recordingService.syncRecordingToServer(recording);
        if (!synced) {
          await recordingService.queueRecordingForSync(recording);
        }

        setRecordings((prev) => [recording, ...prev]);
        handleSuccess(`Recording saved: "${triggerWord}"`);
        return recording;
      } catch (e) {
        handleError(e as Error);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [handleError, handleSuccess]
  );

  /**
   * Load recordings from database
   */
  const loadRecordings = useCallback(async () => {
    try {
      setIsLoading(true);
      const stored = await db.getAll<recordingService.LegacyStoredRecording>(db.STORES.RECORDINGS);
      const normalized = await recordingService.normalizeStoredRecordings(stored);
      const { hydrated, migrated, deletedIds } = normalized;

      await Promise.all([
        ...migrated.map((item) => db.put(db.STORES.RECORDINGS, item)),
        ...deletedIds.map((id) => db.delete_(db.STORES.RECORDINGS, id)),
      ]);

      setRecordings((prev) => {
        revokeRecordingUrls(prev);
        return hydrated;
      });

      setSelectedRecordingIds((prev) => {
        if (prev.size === 0) return prev;

        const validIds = new Set(hydrated.map((item) => item.id));
        return new Set([...prev].filter((id) => validIds.has(id)));
      });

      return hydrated;
    } catch (e) {
      handleError(e as Error);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [handleError, revokeRecordingUrls]);

  /**
   * Delete a single recording
   */
  const deleteRecording = useCallback(
    async (recordingId: string) => {
      try {
        // Revoke URL
        const rec = recordings.find((r) => r.id === recordingId);
        if (rec) {
          URL.revokeObjectURL(rec.url);
        }

        // Delete from all sources
        await Promise.all([
          recordingService.deleteRecordingFromDatabase(recordingId),
          recordingService.removeRecordingFromSyncQueue(recordingId),
        ]);

        // Server delete is best-effort
        recordingService.deleteRecordingFromServer(recordingId).catch(() => {});

        setRecordings((prev) => prev.filter((r) => r.id !== recordingId));
        handleSuccess('Recording deleted');
      } catch (e) {
        handleError(e as Error);
      }
    },
    [recordings, handleError, handleSuccess]
  );

  /**
   * Delete multiple recordings at once
   */
  const deleteMultiple = useCallback(
    async (recordingIds: string[]) => {
      try {
        setIsLoading(true);

        // Revoke URLs
        recordings
          .filter((r) => recordingIds.includes(r.id))
          .forEach((r) => URL.revokeObjectURL(r.url));

        // Delete from database
        await recordingService.deleteRecordingsBulk(recordingIds);

        // Remove from state
        setRecordings((prev) =>
          prev.filter((r) => !recordingIds.includes(r.id))
        );
        setSelectedRecordingIds(new Set());

        handleSuccess(`${recordingIds.length} recording(s) deleted`);
      } catch (e) {
        handleError(e as Error);
      } finally {
        setIsLoading(false);
      }
    },
    [recordings, handleError, handleSuccess]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Filtering & Sorting
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get filtered and sorted recordings
   */
  const getFiltered = useCallback(
    (
      searchQuery?: string,
      keyword?: string,
      confidence?: 'Strong' | 'Good' | 'Weak',
      sortBy?: 'time' | 'keyword' | 'confidence'
    ) => {
      return recordingService.filterAndSortRecordings(recordings, {
        searchQuery,
        keyword,
        confidence,
        sortBy,
      });
    },
    [recordings]
  );

  /**
   * Get memoized filtered recordings (for performance)
   */
  const memoizedFiltered = useMemo(
    () => getFiltered(),
    [recordings, getFiltered]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Statistics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get keyword statistics
   */
  const getKeywordStats = useCallback((): Record<string, KeywordStat> => {
    return recordingService.buildKeywordStats(recordings);
  }, [recordings]);

  const keywordStats = useMemo(() => getKeywordStats(), [recordings, getKeywordStats]);

  // ─────────────────────────────────────────────────────────────────────────
  // Selection Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Toggle selection of a recording
   */
  const toggleSelection = useCallback((recordingId: string) => {
    setSelectedRecordingIds((prev) => {
      const next = new Set(prev);
      if (next.has(recordingId)) {
        next.delete(recordingId);
      } else {
        next.add(recordingId);
      }
      return next;
    });
  }, []);

  /**
   * Toggle select all visible recordings
   */
  const toggleSelectAll = useCallback(
    (visibleRecordings: Recording[]) => {
      if (selectedRecordingIds.size === visibleRecordings.length) {
        setSelectedRecordingIds(new Set());
      } else {
        setSelectedRecordingIds(new Set(visibleRecordings.map((r) => r.id)));
      }
    },
    [selectedRecordingIds.size]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Export
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Export selected recordings (or all if none selected) as ZIP
   */
  const exportAsZip = useCallback(
    async (filename?: string) => {
      try {
        setIsLoading(true);
        const toExport =
          selectedRecordingIds.size > 0
            ? recordings.filter((r) => selectedRecordingIds.has(r.id))
            : recordings;

        if (toExport.length === 0) {
          throw new Error('No recordings to export');
        }

        await recordingService.exportRecordingsAsZip(toExport, filename);
        handleSuccess(`Exported ${toExport.length} recording(s)`);
        setSelectedRecordingIds(new Set());
      } catch (e) {
        handleError(e as Error);
      } finally {
        setIsLoading(false);
      }
    },
    [recordings, selectedRecordingIds, handleError, handleSuccess]
  );

  /**
   * Download a single recording's WAV file
   */
  const downloadRecording = useCallback((recording: Recording) => {
    try {
      const a = document.createElement('a');
      a.href = recording.url;
      a.download = `ad_${recording.triggerWord}_${recording.id}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      handleError(new Error('Download failed'));
    }
  }, [handleError]);

  // ⚡ OPTIMIZATION: Memoize the returned object so it's stable across renders
  // This prevents infinite loops when recordingMgr is used in dependency arrays
  const memoizedMgr = useMemo(() => ({
    // State
    recordings,
    selectedRecordingIds,
    isLoading,
    error,
    keywordStats,

    // State setters
    setRecordings,
    setSelectedRecordingIds,

    // Methods (all memoized with useCallback, so stable)
    addRecording,
    loadRecordings,
    deleteRecording,
    deleteMultiple,
    getFiltered,
    toggleSelection,
    toggleSelectAll,
    exportAsZip,
    downloadRecording,

    // Memoized helpers
    memoizedFiltered,
  }), [
    recordings,
    selectedRecordingIds,
    isLoading,
    error,
    keywordStats,
    addRecording,
    loadRecordings,
    deleteRecording,
    deleteMultiple,
    getFiltered,
    toggleSelection,
    toggleSelectAll,
    exportAsZip,
    downloadRecording,
    memoizedFiltered,
  ]);

  return memoizedMgr;
}
