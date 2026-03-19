/**
 * IndexedDB utility for offline data persistence
 * Stores keywords, recordings, settings, and sync queue
 */

const DB_NAME = 'admonitor-db';
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

// Store names
export const STORES = {
  KEYWORDS: 'keywords',
  RECORDINGS: 'recordings',
  SETTINGS: 'settings',
  SYNC_QUEUE: 'sync-queue',
} as const;

/**
 * Initialize IndexedDB database
 */
export async function initializeDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[IndexedDB] Error opening database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('[IndexedDB] Database initialized successfully');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      console.log('[IndexedDB] Creating object stores...');

      // Keywords store
      if (!database.objectStoreNames.contains(STORES.KEYWORDS)) {
        const keywordStore = database.createObjectStore(STORES.KEYWORDS, { keyPath: 'id' });
        keywordStore.createIndex('word', 'word', { unique: true });
      }

      // Recordings store
      if (!database.objectStoreNames.contains(STORES.RECORDINGS)) {
        const recordingStore = database.createObjectStore(STORES.RECORDINGS, { keyPath: 'id' });
        recordingStore.createIndex('timestamp', 'timestamp');
        recordingStore.createIndex('triggerWord', 'triggerWord');
      }

      // Settings store
      if (!database.objectStoreNames.contains(STORES.SETTINGS)) {
        database.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
      }

      // Sync queue store (for recordings to upload when offline)
      if (!database.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
        database.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Get database instance, initialize if needed
 */
async function getDB(): Promise<IDBDatabase> {
  if (db) return db;
  return initializeDB();
}

/**
 * Add or update record in a store
 */
export async function put<T extends Record<string, any>>(
  storeName: string,
  value: T
): Promise<IDBValidKey> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(value);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

/**
 * Get single record by key
 */
export async function get<T = any>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T | undefined);
  });
}

/**
 * Get all records from a store
 */
export async function getAll<T = any>(storeName: string): Promise<T[]> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T[]);
  });
}

/**
 * Get records by index
 */
export async function getByIndex<T = any>(
  storeName: string,
  indexName: string,
  value: IDBValidKey
): Promise<T[]> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(value);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T[]);
  });
}

/**
 * Delete record by key
 */
export async function delete_(storeName: string, key: IDBValidKey): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Clear all records from a store
 */
export async function clear(storeName: string): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Store setting (key-value pair)
 */
export async function setSetting(key: string, value: any): Promise<void> {
  await put(STORES.SETTINGS, { key, value });
}

/**
 * Get setting by key
 */
export async function getSetting<T = any>(key: string): Promise<T | undefined> {
  const setting = await get(STORES.SETTINGS, key);
  return setting?.value as T | undefined;
}

/**
 * Cache keywords locally for offline access
 */
export async function cacheKeywords(keywords: Array<{ id: number; word: string }>): Promise<void> {
  await clear(STORES.KEYWORDS);
  for (const keyword of keywords) {
    await put(STORES.KEYWORDS, keyword);
  }
}

/**
 * Get cached keywords
 */
export async function getCachedKeywords(): Promise<Array<{ id: number; word: string }>> {
  return getAll(STORES.KEYWORDS);
}

/**
 * Add recording to sync queue (for offline recordings)
 */
export async function queueRecordingForSync(recording: any): Promise<void> {
  await put(STORES.SYNC_QUEUE, { ...recording, queuedAt: new Date().toISOString() });
}

/**
 * Get recordings pending sync
 */
export async function getPendingSyncRecordings(): Promise<any[]> {
  return getAll(STORES.SYNC_QUEUE);
}

/**
 * Remove recording from sync queue after successful sync
 */
export async function removeFromSyncQueue(recordingId: string): Promise<void> {
  await delete_(STORES.SYNC_QUEUE, recordingId);
}

/**
 * Check if database is available
 */
export function isDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * Close database connection
 */
export async function closeDB(): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
}
