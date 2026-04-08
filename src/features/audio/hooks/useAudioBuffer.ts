/**
 * useAudioBuffer — Custom hook for circular PCM buffer management
 * Handles recording, buffering, and extraction of pre/post-trigger audio
 */

import { useCallback, useRef, useState } from 'react';
import * as audioService from '../services/audioService';

export interface UseAudioBufferOptions {
  sampleRate?: number;
  durationSeconds?: number;
  preSeconds?: number;
  postSeconds?: number;
}

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_BUFFER_DURATION = 90; // seconds
const DEFAULT_PRE_TRIGGER = 30; // seconds before trigger
const DEFAULT_POST_TRIGGER = 30; // seconds after trigger

export function useAudioBuffer(options: UseAudioBufferOptions = {}) {
  const sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
  const bufferDuration = options.durationSeconds || DEFAULT_BUFFER_DURATION;
  const preSeconds = options.preSeconds || DEFAULT_PRE_TRIGGER;
  const postSeconds = options.postSeconds || DEFAULT_POST_TRIGGER;

  // Initialize circular buffer
  const bufferRef = useRef<Float32Array | null>(null);
  const writeHeadRef = useRef(0);
  const triggerHeadRef = useRef(0); // Position where trigger occurred

  const [bufferStats, setBufferStats] = useState({
    fillPercentage: 0,
    totalCapacity: 0,
  });

  // Initialize buffer
  const initializeBuffer = useCallback(() => {
    bufferRef.current = audioService.initCircularBuffer(sampleRate, bufferDuration);
    writeHeadRef.current = 0;
    triggerHeadRef.current = 0;
    setBufferStats({
      totalCapacity: sampleRate * bufferDuration,
      fillPercentage: 0,
    });
  }, [sampleRate, bufferDuration]);

  // Write audio chunk to buffer
  const writeChunk = useCallback((audioData: Float32Array) => {
    if (!bufferRef.current) {
      initializeBuffer();
    }

    const newWriteHead = audioService.writeToCircularBuffer(
      bufferRef.current!,
      writeHeadRef,
      audioData
    );

    // Update stats
    const stats = audioService.getCircularBufferStats(
      bufferRef.current!,
      newWriteHead
    );
    setBufferStats({
      fillPercentage: stats.fillPercentage,
      totalCapacity: stats.totalCapacity,
    });
  }, [initializeBuffer]);

  // Snapshot trigger position
  const snapshotTriggerPosition = useCallback(() => {
    triggerHeadRef.current = writeHeadRef.current;
  }, []);

  // Extract pre+post trigger audio as WAV blob
  const extractTriggerAudio = useCallback((): Blob | null => {
    if (!bufferRef.current) {
      return null;
    }

    try {
      return audioService.extractAndEncodeCircularBuffer(
        bufferRef.current,
        triggerHeadRef.current,
        writeHeadRef.current,
        preSeconds,
        postSeconds,
        sampleRate
      );
    } catch (e) {
      console.error('Failed to extract trigger audio:', e);
      return null;
    }
  }, [preSeconds, postSeconds, sampleRate]);

  // Get current buffer fill level (0-1)
  const getFillLevel = useCallback((): number => {
    if (!bufferRef.current) return 0;
    return writeHeadRef.current / bufferRef.current.length;
  }, []);

  // Reset buffer
  const reset = useCallback(() => {
    bufferRef.current = null;
    writeHeadRef.current = 0;
    triggerHeadRef.current = 0;
    setBufferStats({ fillPercentage: 0, totalCapacity: 0 });
  }, []);

  return {
    // State
    bufferStats,

    // Methods
    initializeBuffer,
    writeChunk,
    snapshotTriggerPosition,
    extractTriggerAudio,
    getFillLevel,
    reset,

    // Raw refs (if needed for advanced usage)
    bufferRef,
    writeHeadRef,
    triggerHeadRef,
  };
}
