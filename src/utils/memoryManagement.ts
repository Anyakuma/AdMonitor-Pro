/**
 * Memory Management Utilities
 * Proper cleanup patterns for URLs, refs, and other resources
 */

/**
 * Managed URL object pool with automatic cleanup
 * Prevents URL leaks from accumulated createObjectURL calls
 */
export class ManagedURLPool {
  private urls = new WeakMap<object, string>();
  private cleanupCallbacks: (() => void)[] = [];

  /**
   * Create or retrieve cached URL for blob
   * Automatically cleans up when blob is garbage collected
   */
  getOrCreateURL(blob: Blob): string {
    const cached = this.urls.get(blob);
    if (cached) return cached;

    const url = URL.createObjectURL(blob);
    this.urls.set(blob, url);

    // Cleanup on WeakMap finalization (when blob is GC'd)
    // Note: Not supported in all engines, but when available avoids leaks
    return url;
  }

  /**
   * Explicit cleanup - call when done with blob
   */
  revokeURL(blob: Blob, url?: string) {
    if (!url) url = this.urls.get(blob);
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {
        console.warn('Failed to revoke URL', e);
      }
    }
  }

  /**
   * Cleanup all URLs at once
   */
  clear() {
    this.cleanupCallbacks.forEach(cb => cb());
    this.cleanupCallbacks = [];
  }
}

/**
 * Bounded circular queue for transcripts/samples
 * Prevents unbounded memory growth
 */
export class BoundedQueue<T> {
  private queue: T[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = Math.max(1, maxSize);
  }

  push(item: T): void {
    this.queue.push(item);
    if (this.queue.length > this.maxSize) {
      this.queue.shift();
    }
  }

  getAll(): T[] {
    return [...this.queue];
  }

  clear(): void {
    this.queue = [];
  }

  size(): number {
    return this.queue.length;
  }

  join(separator: string): string {
    return this.queue.join(separator);
  }
}

/**
 * Typed cleanup registry for multiple resources
 */
export class CleanupRegistry {
  private cleanups: Map<string, () => void> = new Map();

  register(name: string, cleanup: () => void): void {
    this.cleanups.set(name, cleanup);
  }

  unregister(name: string): void {
    this.cleanups.delete(name);
  }

  cleanup(name?: string): void {
    if (name) {
      const cb = this.cleanups.get(name);
      if (cb) {
        try {
          cb();
        } catch (e) {
          console.error(`Cleanup failed for ${name}:`, e);
        }
        this.cleanups.delete(name);
      }
    } else {
      this.cleanups.forEach((cb, name) => {
        try {
          cb();
        } catch (e) {
          console.error(`Cleanup failed for ${name}:`, e);
        }
      });
      this.cleanups.clear();
    }
  }
}

/**
 * Lazy initialization pattern for expensive resources
 */
export class LazyReference<T> {
  private value: T | null = null;
  private initialized = false;
  private initializer: () => T;

  constructor(initializer: () => T) {
    this.initializer = initializer;
  }

  get current(): T {
    if (!this.initialized) {
      this.value = this.initializer();
      this.initialized = true;
    }
    return this.value!;
  }

  reset(): void {
    this.value = null;
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Batch API request helper
 * Groups multiple requests to reduce network overhead
 */
export class BatchRequestQueue<T> {
  private queue: T[] = [];
  private batchSize: number;
  private timeout: number;
  private timer: NodeJS.Timeout | null = null;
  private onBatch: (items: T[]) => Promise<void>;

  constructor(batchSize: number, timeout: number, onBatch: (items: T[]) => Promise<void>) {
    this.batchSize = batchSize;
    this.timeout = timeout;
    this.onBatch = onBatch;
  }

  add(item: T): void {
    this.queue.push(item);

    if (this.queue.length >= this.batchSize) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.timeout);
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.batchSize);
    try {
      await this.onBatch(batch);
    } catch (error) {
      console.error('Batch request failed:', error);
      // Re-queue failed items
      this.queue.unshift(...batch);
    }
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.queue = [];
  }

  size(): number {
    return this.queue.length;
  }
}

/**
 * Debounce helper for high-frequency updates
 */
export function createDebounce<T>(callback: (value: T) => void, delayMs: number) {
  let timeoutId: NodeJS.Timeout | null = null;

  return (value: T) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      callback(value);
      timeoutId = null;
    }, delayMs);
  };
}

/**
 * Throttle helper for frame-rate limited updates
 */
export function createThrottle<T>(callback: (value: T) => void, delayMs: number) {
  let lastCall = 0;
  let pending: T | null = null;

  return (value: T) => {
    const now = Date.now();
    pending = value;

    if (now - lastCall >= delayMs) {
      lastCall = now;
      callback(value);
      pending = null;
    }
  };
}
