/**
 * useVisualization — Custom hook for audio visualization and FFT display
 * Handles real-time waveform generation and VAD visualization
 */

import { useState, useRef, useCallback } from 'react';
import * as audioService from '../services/audioService';
import { createThrottle } from '../../../lib/performance/memoryManagement';

export interface UseVisualizationOptions {
  fftBins?: number;
  updateInterval?: number; // milliseconds between FFT updates
}

const DEFAULT_FFT_BINS = 32;
const DEFAULT_UPDATE_INTERVAL = 100; // 10Hz, throttled

export function useVisualization(options: UseVisualizationOptions = {}) {
  const fftBins = options.fftBins || DEFAULT_FFT_BINS;
  const updateInterval = options.updateInterval || DEFAULT_UPDATE_INTERVAL;

  // FFT data
  const [frequencyBins, setFrequencyBins] = useState<number[]>(
    Array(fftBins).fill(0)
  );

  // Voice Activity Detection (VAD)
  const [vadActive, setVadActive] = useState(false);
  const [noiseFloor, setNoiseFloor] = useState(0);
  const [rmsLevel, setRmsLevel] = useState(0);

  // Refs
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const throttledUpdateRef = useRef(
    createThrottle((bins: number[]) => setFrequencyBins(bins), updateInterval)
  );

  // VAD state
  const vadCounterRef = useRef(0);
  const noiseCalibSamplesRef = useRef<number[]>([]);
  const rmsHistoryRef = useRef(0);

  const VAD_HYSTERESIS = audioService.VAD_HYSTERESIS;

  /**
   * Setup analyser and start visualization loop
   */
  const startVisualization = useCallback(
    (analyser: AnalyserNode, sampleRate: number) => {
      analyserRef.current = analyser;
      analyser.fftSize = 256;

      const tick = () => {
        if (!analyserRef.current) return;

        // Get frequency data
        const fData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(fData);

        // Calculate RMS for VAD
        const rms = audioService.calculateRMS(fData);
        rmsHistoryRef.current = rms;
        setRmsLevel(rms);

        // Calibrate noise floor (first 3 seconds)
        if (noiseCalibSamplesRef.current.length < 90) {
          noiseCalibSamplesRef.current.push(rms);

          if (noiseCalibSamplesRef.current.length === 90) {
            const { floor, variance } = audioService.calibrateNoiseFloor(
              noiseCalibSamplesRef.current
            );
            setNoiseFloor(floor);
          }
        }

        // VAD detection
        if (noiseFloor > 0.01) {
          const isVoice = audioService.isVoiceActive(
            rms,
            noiseFloor,
            noiseCalibSamplesRef.current.length > 90 ? 0.1 : 0,
            'medium'
          );

          if (isVoice) {
            vadCounterRef.current = VAD_HYSTERESIS;
          } else {
            vadCounterRef.current = Math.max(0, vadCounterRef.current - 1);
          }

          setVadActive(vadCounterRef.current > 0);
        }

        // Extract and update FFT bins
        const bins = audioService.extractFrequencyBins(analyser, fftBins);
        throttledUpdateRef.current(bins);

        animFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    },
    [fftBins, VAD_HYSTERESIS]
  );

  /**
   * Stop visualization
   */
  const stopVisualization = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  /**
   * Reset calibration
   */
  const resetCalibration = useCallback(() => {
    noiseCalibSamplesRef.current = [];
    setNoiseFloor(0);
    setVadActive(false);
    vadCounterRef.current = 0;
  }, []);

  /**
   * Get voice activity percentage (0-100)
   */
  const getVoiceActivityPercentge = useCallback((): number => {
    if (noiseFloor === 0) return 0;
    return Math.min(100, Math.max(0, (rmsLevel / noiseFloor) * 100));
  }, [rmsLevel, noiseFloor]);

  /**
   * Get calibration progress (0-1)
   */
  const getCalibrationProgress = useCallback((): number => {
    return Math.min(1, noiseCalibSamplesRef.current.length / 90);
  }, []);

  /**
   * Check if still calibrating
   */
  const isCalibrating = useCallback((): boolean => {
    return noiseCalibSamplesRef.current.length < 90;
  }, []);

  /**
   * Directly update FFT bins (used from audio processing loop)
   */
  const updateFFT = useCallback((bins: number[]) => {
    throttledUpdateRef.current(bins);
  }, []);

  /**
   * Directly update VAD state and RMS (used from audio processing loop)
   */
  const updateVAD = useCallback((active: boolean, rmsValue: number) => {
    setVadActive(active);
    setRmsLevel(rmsValue);
  }, []);

  /**
   * Directly set noise floor (used from audio processing loop)
   */
  const setNoiseFloorDirectly = useCallback((floor: number) => {
    setNoiseFloor(floor);
  }, []);

  return {
    // State
    frequencyBins,
    vadActive,
    noiseFloor,
    rmsLevel,

    // Methods
    startVisualization,
    stopVisualization,
    resetCalibration,
    getVoiceActivityPercentge,
    getCalibrationProgress,
    isCalibrating,
    updateFFT,
    updateVAD,
    setNoiseFloor: setNoiseFloorDirectly,

    // Refs (if needed for advanced usage)
    analyserRef,
  };
}
