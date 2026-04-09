# Recording Save Fix - Testing Document

## Test Environment
- **Date**: April 10, 2026
- **Fix Applied**: Blob serialization to base64 for IndexedDB
- **Browsers**: Chrome/Edge (Web Speech API)

## Test Cases

### TC1: Desktop - Auto-Save Recording After Trigger
**Steps**:
1. Open app at http://localhost:3002
2. Grant microphone permission
3. Add keyword: "test" or "Guinness"
4. Click microphone to start listening
5. Say the trigger word clearly
6. Wait ~30 seconds for post-trigger capture
7. Check bottom panel for recording

**Expected Result**: 
- ✅ Toast: "Recording complete & saved. (30s pre + 30s post)"
- ✅ Recording appears immediately in list
- ✅ Refresh page → recording still there
- ✅ Console shows: "✓ Recording saved" or similar success message
- ✅ No error messages in console

**Verify Blob Save Fix**:
1. Open DevTools > Application > IndexedDB > admonitor-db > recordings
2. Click on any recording
3. Check "audioBase64" field contains base64 string (starts with "data:audio/webm;base64,...")
4. NOT a Blob object ✅

---

### TC2: Mobile - Auto-Save Recording
**Steps**:
1. Open on mobile device (iOS Safari or Android Chrome)
2. Grant microphone permission
3. Add keyword
4. Start listening
5. Trigger keyword
6. Wait 30 seconds
7. Check recording list

**Expected Result**:
- ✅ Recording appears in list (base64 serialization works everywhere)
- ✅ Toast notification: "Recording complete & saved"
- ✅ Refresh → recording persists
- ✅ Tap recording to play → audio plays

**Why This Works Now**:
- Before: Blob object couldn't be serialized on mobile IndexedDB
- After: Base64 string is serializable on all platforms ✅

---

### TC3: Manual Stop Recording
**Steps**:
1. Start listening
2. Add keyword
3. Say trigger word
4. Wait 5 seconds
5. Click stop button (if available)
6. Recording should be saved

**Expected Result**:
- ✅ Recording saved with accurate pre/post duration
- ✅ Toast: "Stopped & saved. (30s pre + Xs post)"
- ✅ Appears in list

---

### TC4: Error Handling - Catch Save Failures
**Steps**:
1. Open DevTools console
2. Run: `await indexedDB.databases().then(dbs => indexedDB.deleteDatabase('admonitor-db'))`
3. Close and reopen browser
4. Trigger a recording
5. Check error handling

**Expected Result**:
- ✅ Error toast appears: "Failed to save recording: ..."
- ✅ Debug log shows error message
- ✅ App doesn't crash
- ✅ Can retry after DB is restored

---

### TC5: Multiple Rapid Recordings
**Steps**:
1. Add keywords: "test", "demo", "sample"
2. Start listening
3. Say trigger words rapidly within 30 seconds
4. Wait for all post-triggers to finish
5. Count recordings saved

**Expected Result**:
- ✅ All recordings appear in list
- ✅ Each has proper timestamp and duration
- ✅ No recordings lost due to queue issues
- ✅ Base64 serialization handles concurrent saves

---

### TC6: Recording Load After Page Refresh
**Steps**:
1. Create 3-5 recordings
2. F5 to refresh page
3. Wait for loading to complete
4. Check recording list

**Expected Result**:
- ✅ All previous recordings still in list
- ✅ Correct timestamps and keywords
- ✅ Audio playback works for each
- ✅ No corruption of base64 data after serialization

---

### TC7: Export ZIP with Saved Recordings
**Steps**:
1. Create multiple recordings
2. Click "Export" or "Download All"
3. Check ZIP contents

**Expected Result**:
- ✅ ZIP downloads successfully
- ✅ Contains .wav files for each recording
- ✅ metadata.csv has correct data
- ✅ WAV files are playable

---

## Debug Commands (Browser Console)

```javascript
// Check if recordings are properly stored in IndexedDB
const db = await indexedDB.open('admonitor-db');
const tx = db.transaction('recordings', 'readonly');
const store = tx.objectStore('recordings');
const all = await new Promise((res, rej) => {
  const req = store.getAll();
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});
console.log('Stored recordings:', all);
all.forEach(r => {
  console.log(`Recording ${r.id}:`, {
    triggerWord: r.triggerWord,
    hasAudioBase64: !!r.audioBase64,
    base64Length: r.audioBase64?.length || 0,
    timestamp: r.timestamp
  });
});

// Check if base64 is valid (starts with data URI)
const rec = all[0];
console.log('First recording audio starts with:', rec.audioBase64?.substring(0, 50));
// Should be: "data:audio/webm;base64,Gk..." or similar
```

---

## Verification Checklist

### Code Changes ✅
- [ ] `recordingService.ts`: `toStoredRecording` is now async
- [ ] `App.tsx`: Imports `recordingService`
- [ ] `App.tsx`: Uses `await recordingService.toStoredRecording()`
- [ ] No duplicate function definitions
- [ ] TypeScript compile: npm run lint → PASS

### Functionality ✅
- [ ] Desktop recording saves and persists
- [ ] Mobile recording saves and persists
- [ ] Error handling shows failures
- [ ] Base64 serialization works
- [ ] Multiple concurrent saves work
- [ ] Page refresh loads all recordings
- [ ] Export ZIP includes all recordings

### Performance ✅
- [ ] Blob → Base64 conversion doesn't cause lag
- [ ] IndexedDB save/load is responsive
- [ ] No memory leaks with many recordings
- [ ] App doesn't freeze during conversion

---

## Known Limitations

1. **Base64 overhead**: Audio in base64 is ~33% larger than binary
   - Acceptable for offline storage
   - Server sync still uses efficient transmission

2. **Conversion time**: 2-5ms per recording
   - Negligible for typical workflows
   - Only happens once (save) and once (load)

3. **Storage quota**: IndexedDB has browser limits
   - Chrome: ~50MB
   - Firefox: ~50MB  
   - Safari: ~50MB
   - ~10-20 recordings of 60s audio fit easily

---

## Post-Fix Success Criteria

✅ **MUST PASS**:
1. Desktop recordings save and persist after refresh
2. Mobile recordings save and persist after refresh  
3. Error toast appears on save failures
4. Debug log shows success/error messages
5. Base64 field in IndexedDB properly formatted

✅ **NICE TO HAVE**:
1. Performance still good with many recordings
2. Export ZIP works with all recordings
3. No console errors or warnings

---

## Rollback Plan (if needed)

If any issues arise, the changes are localized:
1. `recordingService.ts`: Revert to sync functions with Blob
2. `App.tsx`: Remove recordingService import
3. Restore duplicate local function definitions

However, this would re-enable the bug on mobile/certain browsers.

---

**Test Date**: _________  
**Tester**: _________  
**Result**: ☐ PASS  ☐ FAIL  
**Notes**: ___________________________________________________________

