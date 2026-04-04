/**
 * Audio Service — Handles audio processing, filtering, VAD, and visualization
 * Extracted from App.tsx to improve maintainability and reusability
 */

// ─────────────────────────────────────────────────────────────────────────────
// Voice Activity Detection (VAD) Setup
// ─────────────────────────────────────────────────────────────────────────────

export interface VADConfig {
  noiseFloor: number;
  variance: number;
  vadCounter: number;
  rms: number;
  sensitivity: 'low' | 'medium' | 'high';
}

export const VAD_HYSTERESIS = 8; // frames to keep VAD "alive" after voice drops

/**
 * Calculate RMS energy for Voice Activity Detection
 */
export function calculateRMS(frequencyData: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < frequencyData.length; i++) {
    sum += (frequencyData[i] / 255) ** 2;
  }
  return Math.sqrt(sum / frequencyData.length);
}

/**
 * Calibrate noise floor from first 3 seconds of audio (~90 frames @ 30Hz)
 */
export function calibrateNoiseFloor(samples: number[]): { floor: number; variance: number } {
  if (samples.length === 0) return { floor: 0, variance: 0 };
  
  const sorted = [...samples].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.8)]; // 80th percentile
  const variance = sorted[Math.floor(sorted.length * 0.95)] - floor; // dynamic range
  
  return { floor, variance };
}

/**
 * Determine if voice is active based on RMS and noise floor
 */
export function isVoiceActive(
  rms: number,
  noiseFloor: number,
  variance: number,
  sensitivity: 'low' | 'medium' | 'high' = 'medium'
): boolean {
  // Adaptive multiplier based on environment noise variance
  let adaptiveMultiplier = Math.max(1.8, Math.min(3.0, 2.0 + variance * 5));
  
  // Adjust for sensitivity setting
  if (sensitivity === 'high') adaptiveMultiplier = Math.max(1.5, adaptiveMultiplier - 0.3);
  if (sensitivity === 'low') adaptiveMultiplier = Math.min(3.5, adaptiveMultiplier + 0.3);
  
  const threshold = Math.max(0.01, noiseFloor * adaptiveMultiplier);
  return rms > threshold;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio Filtering — Bandpass filter (280–3800 Hz) for voice-band isolation
// ─────────────────────────────────────────────────────────────────────────────

export function createVoiceBandFilter(
  audioContext: AudioContext,
  source: MediaStreamAudioSourceNode
): { highpass: BiquadFilterNode; lowpass: BiquadFilterNode } {
  const highpass = audioContext.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 280;
  highpass.Q.value = 0.7;

  const lowpass = audioContext.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 3800;
  lowpass.Q.value = 0.7;

  source.connect(highpass);
  highpass.connect(lowpass);

  return { highpass, lowpass };
}

// ─────────────────────────────────────────────────────────────────────────────
// FFT Visualization — Extract frequency bins for waveform display
// ─────────────────────────────────────────────────────────────────────────────

export function extractFrequencyBins(
  analyser: AnalyserNode,
  bins: number
): number[] {
  const fData = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(fData);
  
  const step = Math.floor(fData.length / bins);
  const result = [];
  
  for (let i = 0; i < bins; i++) {
    const value = fData[i * step] / 255 * 100;
    result.push(Math.max(4, value)); // minimum height of 4%
  }
  
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio Buffer Management — Circular PCM buffer for pre/post-trigger capture
// ─────────────────────────────────────────────────────────────────────────────

export type CircularBufferStats = {
  totalCapacity: number;
  currentWrite: number;
  fillPercentage: number;
};

/**
 * Initialize a circular buffer for audio samples
 * @param sampleRate Audio sample rate (typically 16000 or 44100)
 * @param durationSeconds Buffer duration in seconds (e.g., 90 for 90-second buffer)
 */
export function initCircularBuffer(sampleRate: number, durationSeconds: number): Float32Array {
  const bufferSize = sampleRate * durationSeconds;
  return new Float32Array(bufferSize);
}

/**
 * Write audio chunk to circular buffer
 */
export function writeToCircularBuffer(
  buffer: Float32Array,
  writeHeadRef: { current: number },
  chunk: Float32Array
): number {
  const bufLen = buffer.length;
  const h = writeHeadRef.current;
  const l = chunk.length;
  
  if (h + l <= bufLen) {
    buffer.set(chunk, h);
    writeHeadRef.current = h + l;
  } else {
    const firstPart = bufLen - h;
    buffer.set(chunk.subarray(0, firstPart), h);
    buffer.set(chunk.subarray(firstPart), 0);
    writeHeadRef.current = l - firstPart;
  }
  
  return writeHeadRef.current;
}

/**
 * Get buffer statistics
 */
export function getCircularBufferStats(
  buffer: Float32Array,
  writeHead: number
): CircularBufferStats {
  return {
    totalCapacity: buffer.length,
    currentWrite: writeHead,
    fillPercentage: (writeHead / buffer.length) * 100,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WAV Encoding — Extract and encode circular buffer to WAV format
// ─────────────────────────────────────────────────────────────────────────────

function float32ToInt16(floats: Float32Array): Int16Array {
  const ints = new Int16Array(floats.length);
  for (let i = 0; i < floats.length; i++) {
    ints[i] = floats[i] < 0
      ? floats[i] * 0x8000
      : floats[i] * 0x7fff;
  }
  return ints;
}

function encodeWAV(
  pcmData: Int16Array,
  sampleRate: number
): Blob {
  const channels = 1;
  const bytesPerSample = 2;
  const subChunkSize = pcmData.length * bytesPerSample;

  const buffer = new ArrayBuffer(44 + subChunkSize);
  const view = new DataView(buffer);

  // Headers
  const write = (offset: number, value: number | string, type: 'uint32' | 'uint16' | 'ascii') => {
    if (type === 'uint32') view.setUint32(offset, value as number, true);
    else if (type === 'uint16') view.setUint16(offset, value as number, true);
    else if (type === 'ascii') {
      for (let i = 0; i < (value as string).length; i++) {
        view.setUint8(offset + i, (value as string).charCodeAt(i));
      }
    }
  };

  write(0, 'RIFF', 'ascii');
  write(4, 36 + subChunkSize, 'uint32');
  write(8, 'WAVE', 'ascii');
  write(12, 'fmt ', 'ascii');
  write(16, 16, 'uint32');
  write(20, 1, 'uint16'); // PCM format
  write(22, channels, 'uint16');
  write(24, sampleRate, 'uint32');
  write(28, sampleRate * channels * bytesPerSample, 'uint32');
  write(32, channels * bytesPerSample, 'uint16');
  write(34, 16, 'uint16'); // bits per sample
  write(36, 'data', 'ascii');
  write(40, subChunkSize, 'uint32');

  const int16View = new Int16Array(buffer, 44);
  int16View.set(pcmData);

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Extract pre- and post-trigger window from circular buffer and encode as WAV
 */
export function extractAndEncodeCircularBuffer(
  buffer: Float32Array,
  triggerHeadPosition: number,
  currentWriteHead: number,
  preSeconds: number,
  postSeconds: number,
  sampleRate: number
): Blob {
  const preSamples = preSeconds * sampleRate;
  const postSamples = postSeconds * sampleRate;
  const totalSamples = preSamples + postSamples;
  const bufLen = buffer.length;

  const output = new Float32Array(totalSamples);
  let outIdx = 0;

  // Read pre-trigger samples (go backwards from trigger point)
  for (let i = 0; i < preSamples; i++) {
    const readIdx = (triggerHeadPosition - preSamples + i + bufLen * 100) % bufLen; // add 100x buffer length to avoid negative modulo
    output[outIdx++] = buffer[readIdx];
  }

  // Read post-trigger samples (go forwards from trigger point)
  for (let i = 0; i < postSamples; i++) {
    const readIdx = (triggerHeadPosition + i) % bufLen;
    output[outIdx++] = buffer[readIdx];
  }

  // Normalize and convert to WAV
  let max = 0;
  for (let i = 0; i < output.length; i++) {
    const a = Math.abs(output[i]);
    if (a > max) max = a;
  }
  
  if (max > 0.02 && max < 1) {
    const m = 0.92 / max;
    for (let i = 0; i < output.length; i++) {
      output[i] *= m;
    }
  }

  return encodeWAV(float32ToInt16(output), sampleRate);
}

// ─────────────────────────────────────────────────────────────────────────────
// MIME Type Detection
// ─────────────────────────────────────────────────────────────────────────────

export function getSupportedMimeType(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}
