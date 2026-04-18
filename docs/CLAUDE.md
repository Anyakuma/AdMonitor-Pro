# CLAUDE.md — AdMonitor Pro Developer Guide

**This file is the authoritative guide for AI agents and developers working with AdMonitor Pro.**

---

## 📋 Quick Navigation

- **[Project Overview](#project-overview)** — What this app does
- **[First Time Setup](#first-time-setup)** — Get running in 60 seconds
- **[Common Commands](#common-commands)** — All useful CLI commands
- **[Architecture & Modules](#architecture--modules)** — Complete code structure
- **[Features & UI Pages](#features--ui-pages)** — All screens and functionality
- **[API Endpoints](#api-endpoints)** — Backend routes
- **[Database Schema](#database-schema)** — Data structure
- **[Detection Engine](#detection-engine)** — How speech recognition works
- **[Key Components](#key-components)** — Main React components
- **[Utilities & Helpers](#utilities--helpers)** — Reusable functions
- **[Environment Variables](#environment-variables)** — Configuration
- **[Debugging & Troubleshooting](#debugging--troubleshooting)** — Common issues
- **[AI Agent Guidelines](#ai-agent-guidelines)** — Best practices for AI assistance

---

## Project Overview

**AdMonitor Pro** is an enterprise-grade **radio monitoring and brand protection system** that:

✅ **Detects trigger words** from live audio streams in real-time  
✅ **Records context** (30 seconds before + 30 seconds after trigger)  
✅ **Handles accents & variations** via phoneme expansion, homophones, Soundex  
✅ **Filters noise** with voice-band bandpass (280–3800 Hz) + VAD  
✅ **Scores confidence** using multi-hypothesis voting on 8 speech alternatives  
✅ **Manages recordings** with full search, export, and analytics  

**Use cases:** Brand monitoring, ad compliance, content moderation, regulatory monitoring

---

## First Time Setup

```bash
# 1. Install dependencies
npm install

# 2. Create .env file (copy from .env.example)
cp .env.example .env

# 3. Set DATABASE_URL for PostgreSQL (or leave blank for dev)
# Example: DATABASE_URL=postgres://user:pass@localhost/admonitor

# 4. Start dev server
npm run dev

# 5. Open browser to http://localhost:5173
```

**Note:** The app works offline on first load. Database syncs when connection available.

---

## Common Commands

### Development

```bash
npm run dev                # Start with tsx watch + Vite HMR (http://localhost:5173)
npm run build             # Vite build (outputs to dist/)
npm run preview           # Preview production build locally (http://localhost:4173)
npm run start             # Run production server (requires `npm run build` first)
npm run clean             # Remove dist/ directory
npm run lint              # TypeScript type check (tsc --noEmit)
```

### Development Workflow

```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2 (optional): Check for type errors
npm run lint -- --watch

# The app auto-reloads on:
#  - Server-side changes to server.ts
#  - React component changes (HMR)
#  - CSS/Tailwind changes
```

### Production Deployment

```bash
# Build and test
npm run build
npm run preview

# Deploy to hosting
npm start  # Serves dist/ statically, runs Express API

# Or deploy to Vercel (vercel.json configured)
npm run build  # Vercel runs this automatically
```

---

## Architecture & Modules

### Full-Stack Structure

```
admonitor-pro/
├── src/                          # Frontend (React + TypeScript)
│   ├── App.tsx                   # Main application (1500+ lines, entire speech engine)
│   ├── main.tsx                  # React DOM entry point
│   ├── App.css / index.css        # Global styles (Tailwind-based)
│   ├── components/
│   │   ├── RecordingListItem.tsx  # Single recording card in list
│   │   └── VirtualizedRecordingList.tsx  # Windowed list for 1000+ recordings
│   ├── contexts/
│   │   └── AudioVisualization.tsx # Audio spectrum visualization context
│   ├── utils/
│   │   ├── db.ts                 # IndexedDB wrapper for client-side storage
│   │   ├── phoneticCache.ts      # Phoneme expansion + Soundex/Metaphone
│   │   ├── memoryManagement.ts   # URL pools, cleanup registry, debounce/throttle
│   │   └── optimizedFunctions.ts # Performance-critical voting & matching
│   └── assets/                   # Static files (images, styles)
│
├── public/                       # Public assets served by Express
│   ├── index.html                # Built by Vite (React app)
│   ├── manifest.json             # PWA manifest
│   ├── service-worker.js         # Service worker for offline
│   └── models/                   # ML models (Vosk, optional)
│
├── server.ts                     # Express backend (API + static serving)
├── vite.config.ts                # Vite build config
├── tsconfig.json / .node.json    # TypeScript configs
├── tailwind.config.js            # Tailwind CSS config
├── eslint.config.js              # ESLint rules
├── package.json                  # Dependencies
└── .env.example                  # Environment template
```

### Frontend Structure

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `App.tsx` | **Main app** — speech recognition, keyword mgmt, recording list, UI state | `App` component, all detection logic |
| `RecordingListItem.tsx` | **Recording card** — plays audio, shows metadata, delete button | `RecordingListItem` |
| `VirtualizedRecordingList.tsx` | **Windowed list** — renders 1000+ with minimal DOM | `VirtualizedRecordingList` |
| `AudioVisualization.tsx` | **Waveform context** — real-time spectrum bars during playback | Visualization state |

### Backend Structure

| File | Purpose | Key Routes |
|------|---------|-----------|
| `server.ts` | Express API + Vite middleware/static serving | See [API Endpoints](#api-endpoints) |

---

## Features & UI Pages

### 1️⃣ **Main Listening View** (Top Half of Screen)

Controls for the detection engine:

- **Microphone Toggle** — Start/stop audio listening (Web Speech API)
- **Recording Status** — Shows when listening, number of triggers detected
- **Keyword Input** — Add new keywords to monitor
- **Keyword List** — All active keywords with phoneme variants (expandable)
  - Shows how many times each keyword triggered
  - Last seen timestamp
  - Average confidence score
- **Settings Panel** — Dark mode, debug options, export settings
- **Audio Visualization** — Waveform bars showing input level in real-time

### 2️⃣ **Recording Playback View** (Bottom Half)

Browse, play, and manage triggered recordings:

- **Recording List** — Virtualized scrolling (supports 1000s of recordings)
- **Search Bar** — Filter by keyword, date range, confidence level
- **Recording Card** — Each shows:
  - Trigger word (highlighted)
  - Timestamp (readable format)
  - Confidence badge (Strong/Good/Weak)
  - Audio player with waveform
  - Vote score (0–1, from multi-hypothesis voting)
  - Matched variant (e.g., "honeys" matched to "Hennessy")
  - Transcript preview
- **Bulk Actions** — Select multiple recordings, export as ZIP

### 3️⃣ **Export Feature**

Export recordings as ZIP containing:

- Individual WAV files (audio from circular buffer)
- metadata.json (list with timestamps, keywords, confidence)
- Can download to desktop

### 4️⃣ **Analytics & Statistics**

Dashboard showing:

- Total recordings by keyword (bar chart)
- Confidence distribution (pie chart)
- Hourly/daily detection timeline
- Most-detected keywords
- Detection accuracy metrics

---

## API Endpoints

### Keywords Management

```http
GET    /api/keywords                   # Fetch all keywords
POST   /api/keywords                   # Add new keyword
DELETE /api/keywords/:id               # Delete keyword
```

**Keyword Object:**
```json
{ "id": 1, "word": "Hennessy" }
```

**Auto on POST:** Phoneme variants are cached via `phoneticEngine.getSignature()`

### Recordings Management

```http
GET    /api/recordings                 # Fetch all recordings (paginated)
GET    /api/recordings/:id             # Get single recording detail
POST   /api/recordings                 # Save triggered recording
DELETE /api/recordings/:id             # Delete recording
GET    /api/recordings/export          # Download all as ZIP
```

**Recording Object:**
```json
{
  "id": "uuid-string",
  "triggerWord": "Guinness",
  "duration": 60,
  "timestamp": "2025-04-04T12:34:56Z",
  "audioBase64": "SUQzBAAAAAAAI1NT...",
  "size": 524288,
  "confidence": "Strong",
  "transcript": "whole set of guinness adverts",
  "voteScore": 0.875,
  "matchVariant": "guinness"
}
```

### Settings

```http
GET    /api/settings/:key              # Get setting value
POST   /api/settings/:key              # Save setting
```

---

## Database Schema

### Tables

#### `keywords`
```sql
CREATE TABLE keywords (
  id SERIAL PRIMARY KEY,
  word TEXT UNIQUE NOT NULL
);
```

#### `recordings`
```sql
CREATE TABLE recordings (
  id TEXT PRIMARY KEY,
  triggerWord TEXT NOT NULL,
  duration REAL NOT NULL,
  timestamp TEXT NOT NULL,
  audioBase64 TEXT NOT NULL,
  size INTEGER NOT NULL,
  confidence TEXT DEFAULT 'Strong',
  transcript TEXT,
  voteScore REAL,
  matchVariant TEXT
);
```

#### `settings`
```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### Client-Side Storage (IndexedDB)

**Database:** `admonitor-db` (version 1)

**Stores:**
- `keywords` — Cached keyword signature + variants
- `recordings` — Full recording objects (including base64 audio)
- `settings` — User preferences (theme, sensitivity, etc.)
- `syncQueue` — Recordings pending server sync

---

## Detection Engine

### How It Works (10-Layer Pipeline)

#### **Layer 1: Audio Input & Preprocessing**
- Web Speech API captures mic audio continuously
- **Voice-band bandpass filter** (280–3800 Hz) removes music beds, rumble
- Processed audio fed to speech recognition

#### **Layer 2: Voice Activity Detection (VAD)**
- RMS energy threshold gates the recognizer
- Suppresses false recognitions during silence/music gaps
- **Calibration:** First 3 seconds measure noise floor, adapt threshold

#### **Layer 3: Speech Recognition Hypotheses**
- Web Speech API returns up to 8 alternative transcriptions
- Each with confidence score (0–1)
- Example: `["Hennessy", "henny", "hennessy"]`

#### **Layer 4: Phoneme Expansion**
- At keyword-add time, auto-generate accent/fast-speech variants
- **Vowel substitutions:** a→e/ä/ah, o→aw/oh/oe
- **Consonant patterns:** v→f/b, th→d/t/f
- **Elision:** Drop unstressed vowels ("Vodacom" → "vodcom")
- **Contractions:** Drop -ing/-er/-tion endings
- Variants cached in phonetic signature

#### **Layer 5: Homophone Dictionary**
- Brand names map to common phonetic variants:
  - "Coca-Cola" → ["coke", "cola", "coca"]
  - "Hennessy" → ["henny", "en"]
  - "Guinness" → ["guinness", "gin"]
- Checked during matching

#### **Layer 6: Matching Algorithm** (`matchTranscriptToKeyword_OPTIMIZED`)
- For each hypothesis, check if it contains keyword/variant/homophone
- **Soundex + Metaphone** phonetic matching (if edit distance > 2)
- **N-gram window:** Detects keywords split across boundaries
  - Keeps last 4 results, searches for keyword in 4-word sliding window
  - Catches: "I think... Guinness is good" (2-result gap)
- Returns match result + matched variant

#### **Layer 7: Multi-Hypothesis Voting** (`voteOnHypotheses_OPTIMIZED`)
- Checks all hypotheses, counts votes for each keyword
- **Vote weight:** Confidence score of hypothesis × hypothesis index weight
- **Confidence classification:**
  - **Strong:** ≥4 hypotheses matched OR confidence ≥0.85
  - **Good:** 2–3 hypotheses matched OR confidence ≥0.65
  - **Weak:** 1 hypothesis matched OR confidence <0.65
- Returns vote score (fraction of hypotheses that matched)

#### **Layer 8: Syllable Guard**
- Prevents single phoneme matches from triggering on unrelated words
- Example: Block "a" in "and" even if keyword is "a"
- Compares syllable count (min 2 syllables to trigger)

#### **Layer 9: Per-Keyword Cooldown**
- Prevents duplicate triggers within 10 seconds
- Timer per keyword (not global)
- Allows "Guinness" + "Hennessy" to trigger 2 seconds apart

#### **Layer 10: Dynamic Grammar Refresh**
- When keywords change during listening, Web Speech grammar rebuilds
- New keywords added/removed = new grammar instantly
- No restart needed

### Key Performance Metrics

| Function | Before | After | Optimization |
|----------|--------|-------|---------------|
| `voteOnHypotheses` | 2.3ms | 0.8ms | Pre-compute maps, single-pass voting |
| `matchTranscriptToKeyword` | 1.5ms | 0.4ms | Early exit on match, cached Soundex |
| Recording list render (1000+) | 800ms | 45ms | React Window virtualization |
| App startup | 1.2s | 280ms | PhoneticCache preload, lazy refs |

---

## Key Components

### `App.tsx` (1500+ lines)

**Main monolithic component containing:**

1. **State Management:**
   - `isListening` — Microphone active?
   - `keywords` — Array of keyword objects with stats
   - `recordings` — Array of triggered recordings
   - `recognitionRef` — Web Speech API instance
   - `circularBufferRef` — 90-second audio ring buffer
   - `triggerWriteHeadRef` — Position when keyword triggered

2. **Hooks:**
   - `useEffect` — Initialize DB, setup speech recognition, cleanup
   - `useCallback` — Memoized handlers (speech events, UI actions)
   - `useMemo` — Pre-compute keyword stats, filtered recordings
   - `useRef` — For circular buffer, recognition state, cleanup

3. **Event Handlers:**
   - `handleMicToggle()` — Start/stop listening
   - `handleAddKeyword()` — Phoneme expansion + grammar refresh
   - `handleDeleteKeyword()` — Remove from list + sync DB
   - `handleTriggerKeyword()` — Save recording to circular buffer context
   - `handlePlayRecording()` — Load audio + play
   - `handleDeleteRecording()` — Remove from DB
   - `handleExportZIP()` — Package all recordings + metadata

4. **UI Sections:**
   - Header with dark mode toggle
   - Listening controls (mic button, status)
   - Keyword input + active list
   - Settings modal
   - Recording list (virtualized)
   - Analytics dashboard

### `RecordingListItem.tsx`

**Single recording card:**
- Trigger word (highlighted)
- Timestamp + confidence badge
- Audio player with waveform
- Vote score + matched variant
- Delete button

### `VirtualizedRecordingList.tsx`

**Windowed list using `react-window`:**
- Renders only visible rows (~10–20 at a time)
- Handles 1000+ recordings smoothly
- Scrolling event listeners for pagination

### `AudioVisualization.tsx`

**Context providing:**
- Waveform data (real-time spectrum)
- Playback state
- Audio level meters

---

## Utilities & Helpers

### `db.ts` — IndexedDB Wrapper

```typescript
// Core operations
export async function put<T>(storeName: string, value: T): Promise<void>
export async function get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined>
export async function getAll<T>(storeName: string): Promise<T[]>
export async function delete_(storeName: string, key: IDBValidKey): Promise<void>
export async function clear(storeName: string): Promise<void>
export async function getByIndex<T>(storeName: string, indexName: string, value: any): Promise<T[]>

// Settings operations
export async function setSetting(key: string, value: any): Promise<void>
export async function getSetting<T>(key: string): Promise<T | undefined>

// Caching
export async function cacheKeywords(keywords: Array<{id: number; word: string}>): Promise<void>
export async function getCachedKeywords(): Promise<Array<{id: number; word: string}>>

// Sync queue
export async function queueRecordingForSync(recording: any): Promise<void>
export async function getPendingSyncRecordings(): Promise<any[]>
export async function removeFromSyncQueue(recordingId: string): Promise<void>

// Utilities
export function isDBAvailable(): boolean
export async function closeDB(): Promise<void>
```

### `phoneticCache.ts` — Phoneme Recognition Engine

```typescript
export interface PhoneticSignature {
  keyword: string;
  soundex: string;
  metaphone: string;
  variants: string[];
  homophones: string[];
}

export class CachedPhoneticEngine {
  // Get cached phonetic data for keyword
  getSignature(keyword: string): PhoneticSignature

  // Check if transcript matches keyword via phonetics
  matchesKeyword(transcript: string, keyword: string): boolean

  // Internal: Soundex algorithm
  getSoundex(s: string): string

  // Internal: Metaphone algorithm
  getMetaphone(s: string): string

  // Internal: Expand keyword variants
  expandKeywordOptimized(base: string): string[]

  // Clear cache (memory cleanup)
  clear(): void
}

export const phoneticEngine = new CachedPhoneticEngine()
```

### `memoryManagement.ts` — Performance & Memory

```typescript
// URL blob pool (prevents memory leaks)
export class ManagedURLPool {
  createURL(blob: Blob): string
  revokeURL(blob: Blob): void
  revokeAll(): void
}

// Bounded FIFO queue (max N items)
export class BoundedQueue<T> {
  push(item: T): boolean
  pop(): T | undefined
  size(): number
  clear(): void
}

// Cleanup callbacks registry
export class CleanupRegistry {
  register(name: string, callback: () => void): void
  invoke(name: string): void
  invokeAll(): void
}

// Debounce & throttle utilities
export function createDebounce<T>(callback: (value: T) => void, delayMs: number)
export function createThrottle<T>(callback: (value: T) => void, delayMs: number)
```

### `optimizedFunctions.ts` — Critical Functions

```typescript
// Voting engine: checks all hypotheses against keywords
export const voteOnHypotheses_OPTIMIZED = (
  allHypotheses: Array<{ transcript: string; confidence?: number }>,
  keywords: string[],
  expandedMap: Map<string, string[]>,
  homoMap: Map<string, string[]>,
  sensitivity: 'high' | 'medium' | 'low'
): Array<{
  keyword: string;
  confidence: Confidence;
  voteScore: number;
  transcript: string;
  matchVariant: string;
}>

// Matching: check if transcript contains keyword
export const matchTranscriptToKeyword_OPTIMIZED = (
  transcript: string,
  keyword: string,
  variants: string[],
  sensitivity: 'high' | 'medium' | 'low'
): { matched: boolean; variant: string; matchType: string }

// Recording list filtering + sorting
export const getFilteredAndSortedRecordings = (
  recordings: Recording[],
  filterOptions: {
    searchQuery?: string;
    keyword?: string;
    confidence?: Confidence;
    dateRange?: [Date, Date];
    sortBy?: 'date' | 'confidence' | 'keyword';
  }
): Recording[]
```

---

## Environment Variables

### Required

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/admonitor
# PostgreSQL connection string for production
# Leave blank for dev (uses IndexedDB)

PORT=3002
# Server port (default: 3002)

NODE_ENV=development|production
# Set to "production" for production builds
```

### Optional

```bash
GEMINI_API_KEY=your-api-key
# Google Gemini API key (exposed client-side, used in analytics)
# Leave blank to disable AI features

DISABLE_HMR=false
# Set to 'true' to disable Vite HMR (for AI Studio environments)

VITE_API_URL=http://localhost:3002
# Frontend API endpoint (used in development)
```

### Development Template (`.env.example`)

```bash
# .env.example — Copy to .env and fill in values
DATABASE_URL=
PORT=3002
NODE_ENV=development
GEMINI_API_KEY=
DISABLE_HMR=false
VITE_API_URL=http://localhost:3002
```

---

## Debugging & Troubleshooting

### Issue: App won't start

**Error: "Cannot find module 'react'"**
```bash
# Solution: Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

**Error: "EADDRINUSE: address already in use :::3002"**
```bash
# Solution: Change port in .env
PORT=3003 npm run dev
```

### Issue: Speech recognition not working

**Symptoms:** Microphone doesn't trigger recordings despite audio input

1. **Check browser support** — Web Speech API requires Chromium (Chrome, Edge, etc.)
2. **Check microphone permissions** — Grant access in browser settings
3. **Check audio format** — Ensure 16-bit PCM, 16kHz sample rate
4. **Check VAD threshold** — Audio may be too quiet; adjust in settings
5. **Enable debug mode** — Check console for speech events:
   ```typescript
   // In App.tsx, uncomment:
   // console.log('Speech result:', event.results);
   ```

### Issue: Keyword detection unreliable

**Words often not detected:**

1. **Add phoneme variants** — Keyword may need more variants
   - Try adding different pronunciations manually
   - Check `phoneticCache.ts` for expansion rules

2. **Adjust sensitivity** — Settings > Detection > Sensitivity
   - Set to "High" for difficult words
   - Set to "Low" to reduce false positives

3. **Check confidence threshold** — Only mark "Strong" if ≥0.85
   - Lower in Settings > Confidence Threshold

4. **Enable debug** — See matched variants in console

### Issue: Memory leak / App slows down after hours

**Symptoms:** Recording list scrolling gets laggy, memory usage grows

1. **Clear old recordings** — Delete recordings older than N days
2. **Clear IndexedDB cache** — DevTools > Application > IndexedDB > Clear
3. **Restart browser** — Clears service worker cache
4. **Check URL pool** — Verify Blob URLs are being revoked:
   ```typescript
   console.log('Active URLs:', urlPool.size());
   ```

### Issue: Database sync fails

**Error: "Failed to sync recordings to server"**

1. **Check DATABASE_URL** — Connection string must be valid
2. **Check network** — Verify database is reachable
3. **Check credentials** — Username/password in connection string
4. **Check SSL** — In production, may need `?sslmode=require`

---

## AI Agent Guidelines

### 🤖 When Helping with Code

#### **Best Practices**

1. **Always check codebase first** — Don't invent features; read App.tsx to understand state
2. **Preserve phonetic architecture** — Detection engine is mission-critical; any changes must pass detection tests
3. **Optimize before refactoring** — Performance is prioritized (see `optimizedFunctions.ts`)
4. **Use TypeScript strictly** — All new code must be `strict` mode

#### **Common Tasks**

**Add a new feature:**
```typescript
// 1. Add state in App.tsx
const [newFeature, setNewFeature] = useState(false);

// 2. Add UI (usually in JSX at bottom of App.tsx)
<button onClick={() => setNewFeature(!newFeature)}>
  Toggle Feature
</button>

// 3. Add handler / logic
const handleNewFeature = useCallback(() => {
  // Your logic here
}, [dependencies]);

// 4. Test & export if reusable
export const newFeatureLogic = () => { /* ... */ };
```

**Add a new keyword:**
- Phonetic expansion is automatic via `phoneticEngine.getSignature()`
- No additional code needed; just call API POST /api/keywords

**Optimize a slow function:**
- Profile in DevTools > Performance
- Reference `optimizedFunctions.ts` for patterns
- Use memos, reduce, and pre-compute maps

#### **Testing**

```bash
# Type check
npm run lint

# Build & test
npm run build
npm run preview
```

#### **Common Mistakes to Avoid**

1. ❌ Don't mutate state directly — Always use setState()
2. ❌ Don't create new objects in JSX — Use useMemo/useCallback
3. ❌ Don't add expensive logic to render path — Move to useEffect
4. ❌ Don't forget cleanup in useEffect — Always return cleanup function
5. ❌ Don't hardcode DB connection — Always read from DATABASE_URL

#### **File Structure Rules**

- **App.tsx** — Stays monolithic; don't refactor into 10 files (team preference)
- **utils/** — Reusable business logic (phonetics, DB operations, optimization)
- **components/** — Presentational React components (RecordingListItem, etc.)
- **contexts/** — React context for global state (AudioVisualization)

#### **Documentation**

- Add JSDoc comments on public functions
- Update this CLAUDE.md when architecture changes
- Add inline comments for non-obvious detection logic

---

## Stack & Technologies

| Category | Tools |
|----------|-------|
| **Frontend** | React 19, TypeScript 5.8, Vite 6, Tailwind CSS 4 |
| **Backend** | Express.js, Node.js |
| **Database** | PostgreSQL (production), IndexedDB (client) |
| **Speech** | Web Speech API (Chrome/Edge), Vosk (optional) |
| **UI** | Lucide React (icons), Framer Motion (animations), Sonner (toasts) |
| **Audio** | Web Audio API (filtering, VAD), JSZip (export) |
| **Build** | Vitest (testing), ESLint, TypeScript strict mode |

---

## Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set `DATABASE_URL` to production PostgreSQL
- [ ] Set `GEMINI_API_KEY` if using analytics
- [ ] Run `npm run build`
- [ ] Test with `npm run preview`
- [ ] Deploy `dist/` and `server.ts` to hosting
- [ ] Verify `/api/keywords` responds
- [ ] Verify `/api/recordings` responds
- [ ] Test recording + playback flow

---

## Support & Resources

- **Speech Recognition:** [Web Speech API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- **React Docs:** [react.dev](https://react.dev)
- **TypeScript:** [typescriptlang.org](https://typescriptlang.org)
- **Tailwind CSS:** [tailwindcss.com](https://tailwindcss.com)

**Last Updated:** April 4, 2026  
**Version:** 3.0 (30s + 30s recording, multi-hypothesis voting, phoneme expansion)
