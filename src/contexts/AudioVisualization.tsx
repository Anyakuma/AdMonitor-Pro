/**
 * Audio Visualization Context
 * Separates high-frequency FFT/VAD updates from main component
 * Prevents full app re-renders on every audio frame
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

interface AudioVisualizationContextType {
  fftBins: number[];
  vadActive: boolean;
  rms: number;
  noiseFloor: number;
  updateFFT: (bins: number[]) => void;
  updateVAD: (active: boolean, rms: number) => void;
  setNoiseFloor: (floor: number) => void;
}

const AudioVisualizationContext = createContext<AudioVisualizationContextType | null>(null);

/**
 * Provider component - separate from main App to isolate re-renders
 */
export function AudioVisualizationProvider({ children }: { children: React.ReactNode }) {
  const [fftBins, setFftBins] = useState<number[]>(Array(32).fill(0));
  const [vadActive, setVadActive] = useState(false);
  const [rms, setRms] = useState(0);
  const [noiseFloor, setNoiseFloor] = useState(0);

  // Throttle FFT updates to 10Hz instead of 30Hz (still smooth for human eyes)
  const fftThrottleRef = useRef(0);
  const updateFFT = useCallback((bins: number[]) => {
    const now = Date.now();
    if (now - fftThrottleRef.current > 100) { // ~10Hz
      fftThrottleRef.current = now;
      setFftBins(bins);
    }
  }, []);

  const updateVAD = useCallback((active: boolean, rmsValue: number) => {
    setVadActive(active);
    setRms(rmsValue);
  }, []);

  const value: AudioVisualizationContextType = {
    fftBins,
    vadActive,
    rms,
    noiseFloor,
    updateFFT,
    updateVAD,
    setNoiseFloor,
  };

  return (
    <AudioVisualizationContext.Provider value={value}>
      {children}
    </AudioVisualizationContext.Provider>
  );
}

export function useAudioVisualization() {
  const context = useContext(AudioVisualizationContext);
  if (!context) {
    throw new Error('useAudioVisualization must be used within AudioVisualizationProvider');
  }
  return context;
}
