# 🚀 Quick Start Guide — Using New Services & Hooks

**For developers integrating the refactored code into App.tsx**

---

## Installation (Already Done!)

All files are created and ready to use:

```
✅ src/services/              (3 services)
✅ src/hooks/                 (4 hooks)
✅ docs/REFACTORING_GUIDE.md   (detailed guide)
```

---

## Quick Examples

### 1️⃣ Audio Buffer Management

**Before (in App.tsx):**
```typescript
const circBufRef = useRef<Float32Array | null>(null);
const writeHeadRef = useRef(0);
const triggerWriteHeadRef = useRef(0);

// Complex buffer logic scattered throughout
```

**After (using hook):**
```typescript
import { useAudioBuffer } from './hooks/useAudioBuffer';

const { writeChunk, snapshotTriggerPosition, extractTriggerAudio } = useAudioBuffer();

// In audio processor
audioProcessor.onaudioprocess = (e) => {
  writeChunk(e.inputBuffer.getChannelData(0));
};

// On keyword trigger
const handleTrigger = () => {
  snapshotTriggerPosition();
  // Wait 30 seconds...
  const wav = extractTriggerAudio(); // Done!
};
```

---

### 2️⃣ Keyword Detection & Voting

**Before (in App.tsx):**
```typescript
const result = voteOnHypotheses_OPTIMIZED(hyps, keywordSignaturesRef.current, sensitivityRef.current);
if (result.matched) {
  // Apply cooldown manually...
  const lastFire = cooldownRef.current.get(result.keyword) || 0;
  if (Date.now() - lastFire < COOLDOWN_MS) return;
  cooldownRef.current.set(result.keyword, Date.now());
}
```

**After (using hook):**
```typescript
import { useKeywordDetection } from './hooks/useKeywordDetection';

const { detectFromHypotheses } = useKeywordDetection({ 
  cooldownMs: 10000,
  sensitivityLevel: sensitivity 
});

const result = detectFromHypotheses(hyps, keywordSignatures);
// Cooldown is automatic! ✨
```

---

### 3️⃣ Recording Management

**Before (in App.tsx):**
```typescript
setRecordings(prev => [rec, ...prev]);
try {
  await db.put(db.STORES.RECORDINGS, toStoredRecording(rec));
} catch {}
try {
  const b64 = await blobToBase64(finalBlob);
  await fetch('/api/recordings', { /* complex body */ });
} catch {
  await db.queueRecordingForSync({/* ... */});
}
```

**After (using hook):**
```typescript
import { useRecordingManager } from './hooks/useRecordingManager';

const { addRecording } = useRecordingManager();

const rec = await addRecording(
  blob, 
  triggerWord,    // "Guinness"
  60,             // duration in seconds
  'Strong',       // confidence
  'transcript',   // full text
  0.95,           // vote score
  'variant'       // matched variant
);
// Saves to DB, syncs to server, or queues if offline ✨
```

---

### 4️⃣ Filtering & Exporting

**Before (in App.tsx):**
```typescript
const filteredRecs = useMemo(() => {
  return getFilteredAndSortedRecordings(recordings, debouncedSearch, sortBy);
}, [recordings, debouncedSearch, sortBy]);

const exportZip = async () => {
  const toExp = selectedRecs.size ? recordings.filter(/*...*/) : recordings;
  const zip = new JSZip();
  // 20+ lines of ZIP logic...
};
```

**After (using hook):**
```typescript
import { useRecordingManager } from './hooks/useRecordingManager';

const { getFiltered, exportAsZip } = useRecordingManager();

// Search + sort
const filtered = getFiltered('guinness', undefined, 'Strong', 'time');

// Export
await exportAsZip('my_ads.zip');
// All recording files + metadata.csv ✨
```

---

### 5️⃣ Real-Time Visualization

**Before (in App.tsx):**
```typescript
const analyserRef = useRef<AnalyserNode | null>(null);
const fftThrottleRef = useRef(0);
const throttleFftRef = useRef(createThrottle((bins: number[]) => setFftBins(bins), 100));

// Complex FFT extraction in requestAnimationFrame loop...
```

**After (using hook):**
```typescript
import { useVisualization } from './hooks/useVisualization';

const { frequencyBins, startVisualization, vadActive } = useVisualization();

// Start when AudioContext ready
useEffect(() => {
  startVisualization(analyser, audioContext.sampleRate);
}, []);

// Render bars
<div className="flex gap-1">
  {frequencyBins.map((val, i) => (
    <div key={i} style={{ height: `${val}%` }} />
  ))}
</div>
```

---

## Import Cheat Sheet

```typescript
// ─────────────────────────────────────────────────
// Hooks (use these!)
// ─────────────────────────────────────────────────
import { useAudioBuffer } from './hooks/useAudioBuffer';
import { useKeywordDetection } from './hooks/useKeywordDetection';
import { useRecordingManager } from './hooks/useRecordingManager';
import { useVisualization } from './hooks/useVisualization';

// ─────────────────────────────────────────────────
// Services (call these directly if needed)
// ─────────────────────────────────────────────────
import * as audioService from './services/audioService';
import * as detectionService from './services/detectionService';
import * as recordingService from './services/recordingService';

// ─────────────────────────────────────────────────
// Types (for TypeScript)
// ─────────────────────────────────────────────────
import type { Recording, KeywordStat } from './services/recordingService';
import type { Confidence } from './services/detectionService';
```

---

## Step-by-Step Integration

### Step 1: Add Hooks to App.tsx
```typescript
export default function App() {
  // ← Add these 4 lines
  const audioBuffer = useAudioBuffer();
  const detection = useKeywordDetection({ sensitivityLevel: sensitivity });
  const recordingMgr = useRecordingManager();
  const visualization = useVisualization();

  // ← Keep existing state for now
  const [isListening, setIsListening] = useState(false);
  // ...
}
```

### Step 2: Replace One Handler at a Time
```typescript
// BEFORE
const saveRecording = useCallback(async (blob, ...) => {
  // 30 lines of complex logic
}, []);

// AFTER
// Just call: recordingMgr.addRecording(blob, ...)
```

### Step 3: Simplify Event Handlers
```typescript
// Replace refs with hook values
// Replace callbacks with hook methods
// Remove duplicate logic
```

### Step 4: Remove Redundant Code
```typescript
// Delete expandKeyword, getHomophones, getSoundex, etc.
// Delete manual buffer management
// Delete recording save/sync logic
// delete export ZIP logic
```

---

## Common Patterns

### Pattern 1: Add Recording on Detection
```typescript
const handleDetection = async (
  blob: Blob,
  triggerWord: string,
  confidence: Confidence
) => {
  const recording = await recordingMgr.addRecording(
    blob,
    triggerWord,
    60,
    confidence,
    transcript,
    voteScore,
    variant
  );
  
  if (recording) {
    toast.success(`Recording saved: "${triggerWord}"`);
  }
};
```

### Pattern 2: Filter & Display Recordings
```typescript
const [searchQuery, setSearchQuery] = useState('');
const [sortBy, setSortBy] = useState<'time'|'keyword'|'confidence'>('time');

const filtered = recordingMgr.getFiltered(searchQuery, undefined, undefined, sortBy);

return (
  <>
    <input onChange={e => setSearchQuery(e.target.value)} />
    <RecordingList recordings={filtered} />
  </>
);
```

### Pattern 3: Export Selected Recordings
```typescript
const handleExport = async () => {
  recordingMgr.setSelectedRecordingIds(new Set()); // Keep selected
  await recordingMgr.exportAsZip('my-exports.zip');
};
```

### Pattern 4: Visualize Audio
```typescript
// Setup
useEffect(() => {
  if (audioContext && analyser) {
    visualization.startVisualization(analyser, audioContext.sampleRate);
  }
  return () => visualization.stopVisualization();
}, [audioContext]);

// Render
<div className="flex gap-1">
  {visualization.frequencyBins.map((val, i) => (
    <Bar key={i} height={val} />
  ))}
</div>
```

---

## Testing Services Directly

Services can be tested without React:

```typescript
// test/detectionService.test.ts
import * as detectionService from '../services/detectionService';

describe('detectionService', () => {
  it('should match keyword variants', () => {
    const result = detectionService.matchTranscriptToKeyword(
      'I love that henny',
      'Hennessy',
      ['heneken', 'henny', 'eken'],
      { sensitivity: 3 }
    );
    
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe('Good');
    expect(result.variant).toBe('henny');
  });
});
```

---

## Performance Tips

1. **Memoize filtered recordings:**
   ```typescript
   const filtered = useMemo(
     () => recordingMgr.getFiltered(search, keyword, conf, sort),
     [search, keyword, conf, sort]
   );
   ```

2. **Debounce search input:**
   ```typescript
   const [debouncedSearch, setDebouncedSearch] = useState('');
   const debounceRef = useRef(createDebounce(setDebouncedSearch, 300));
   
   const handleSearch = (e) => {
     setSearchQuery(e.target.value);
     debounceRef.current(e.target.value);
   };
   ```

3. **Throttle FFT updates:** (done automatically with `useVisualization`)

4. **Use `memoizedFiltered` from hook:**
   ```typescript
   const { memoizedFiltered } = recordingMgr; // Already memoized!
   ```

---

## Next: Read Full Documentation

→ Open [`docs/REFACTORING_GUIDE.md`](../docs/REFACTORING_GUIDE.md) for:
- Complete API reference for all hooks & services
- Migration checklist
- Architecture diagrams
- FAQ & troubleshooting

---

## Need Help?

1. Check JSDoc comments in source files (hover over any function/type)
2. Review the migration guide: `docs/REFACTORING_GUIDE.md`
3. Look at examples in this file
4. Check `CLAUDE.md` for architecture context

---

**Happy refactoring!** 🎉
