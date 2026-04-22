/**
 * AudioWorklet processor for AdMonitor Pro.
 * This runs on a separate high-priority audio thread, offloading audio processing
 * from the main UI thread to prevent stutters and improve performance.
 *
 * It receives 128-sample chunks from the microphone, buffers them into larger
 * chunks (16 * 128 = 2048 samples), and then posts them to the main thread for
 * analysis (Vosk, Deepgram, circular buffer writing).
 */
class AudioProcessor extends AudioWorkletProcessor {
  // Buffer 16 chunks of 128 samples to get 2048 samples
  static SAMPLES_PER_CHUNK = 128;
  static CHUNKS_TO_BUFFER = 16;

  _buffer = new Float32Array(AudioProcessor.SAMPLES_PER_CHUNK * AudioProcessor.CHUNKS_TO_BUFFER);
  _bufferIndex = 0;

  process(inputs) {
    const inputChannel = inputs[0]?.[0];

    if (inputChannel && inputChannel.length === AudioProcessor.SAMPLES_PER_CHUNK) {
      this._buffer.set(inputChannel, this._bufferIndex * AudioProcessor.SAMPLES_PER_CHUNK);
      this._bufferIndex++;

      if (this._bufferIndex === AudioProcessor.CHUNKS_TO_BUFFER) {
        this.port.postMessage(this._buffer);
        this._bufferIndex = 0;
      }
    }
    return true; // Keep processor alive
  }
}

registerProcessor('audio-processor', AudioProcessor);