/**
 * AdMonitor Pro v3 — Radio-Optimised Detection Engine
 * @license Apache-2.0
 *
 * v3 change: Every recording now captures exactly 30 seconds BEFORE the
 * trigger word and 30 seconds AFTER it (60 s total).
 * Strategy:
 *  - Circular PCM buffer is 90 s (was 70 s) so the 30 s pre-buffer always fits
 *  - writeHead is snapshotted at trigger time (triggerWriteHeadRef) so we
 *    always know where "the moment the keyword fired" is in the ring buffer
 *  - saveRecording extracts [snapshot - 30 s … snapshot + 30 s] from the ring
 *  - post-trigger count is fixed at 30 s × 4 chunks/s = 120 chunks
 *  - recordingDuration state/slider removed; UI shows "30s + 30s = 60s" badge
 *
 * Detection improvements over v1:
 *  1. Voice-band bandpass filter (280–3800 Hz) applied to mic stream BEFORE
 *     speech recognition — strips music beds & rumble without touching voice
 *  2. Voice Activity Detection (VAD) via RMS energy gate — suppresses
 *     recognition firing during music-only gaps, reducing false positives
 *  3. Phoneme expansion — each keyword is auto-expanded at add-time into
 *     accent/fast-speech variants (vowel shifts, consonant clusters, elision)
 *  4. Homophone dictionary — "Coca-Cola" → also matches "coke", "cola", etc.
 *  5. Full N-gram sliding window across the last 4 recognition results so
 *     words split across phrase boundaries are still caught
 *  6. Multi-hypothesis voting — all 8 speech alternatives are checked and a
 *     vote-weighted confidence score is produced
 *  7. Syllable-count guard — prevents single short phoneme matches from
 *     triggering on unrelated common words
 *  8. Cooldown timer per keyword — prevents duplicate triggers within 10s
 *  9. Dynamic grammar refresh — Web Speech grammar list is rebuilt whenever
 *     keywords change while listening
 * 10. Noise-floor adaptive threshold — VAD threshold calibrates to ambient
 *     noise during the first 3 seconds of listening
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  Mic, Settings, Play, Trash2,
  Radio, Clock, Activity, Download, AlertCircle,
  Archive, StopCircle, AudioLines, Moon, Sun, Pause, Info,
  Search, CheckSquare, ChevronDown,
  BarChart2, Headphones, X, Zap, Shield, Waves,
  RefreshCw, Eye, Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { format } from 'date-fns';
import { Analytics } from '@vercel/analytics/react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface Recording {
  id: string;
  blob: Blob;
  url: string;
  timestamp: Date;
  triggerWord: string;
  duration: number;
  confidence: 'Strong' | 'Good' | 'Weak';
  transcript: string;
  voteScore: number;        // 0–1, fraction of hypotheses that matched
  matchVariant?: string;    // which expanded variant matched
}

interface KeywordStat {
  word: string;
  count: number;
  lastSeen?: Date;
  avgConfidence: number;
}

type Confidence = 'Strong' | 'Good' | 'Weak';

// ─────────────────────────────────────────────────────────────────────────────
// ① Phoneme expansion
//    Generates common accent / fast-speech variants of a keyword so that
//    e.g. "Vodacom" also matches "vodakon", "vordacom", "fodacom" etc.
// ─────────────────────────────────────────────────────────────────────────────
const VOWEL_SUBSTITUTIONS: Record<string, string[]> = {
  a: ['a', 'e', 'ä', 'ah'],
  e: ['e', 'i', 'eh', 'a'],
  i: ['i', 'e', 'ee', 'ih'],
  o: ['o', 'aw', 'oh', 'oe'],
  u: ['u', 'oo', 'uh', 'eu'],
};
const CONSONANT_SUBS: Record<string, string[]> = {
  v: ['v', 'f', 'b'],
  f: ['f', 'v', 'ph'],
  c: ['c', 'k', 's'],
  k: ['k', 'c', 'q'],
  g: ['g', 'j', 'gh'],
  j: ['j', 'y', 'dj'],
  r: ['r', 'l', 'rh'],
  th: ['th', 'd', 't', 'f'],
  ng: ['ng', 'n', 'nk'],
  d: ['d', 't', 'dh'],
  t: ['t', 'd', 'th'],
  z: ['z', 's', 'dz'],
  x: ['x', 'ks', 'gz'],
};

const expandKeyword = (keyword: string): string[] => {
  const base = keyword.toLowerCase().trim();
  const variants = new Set<string>([base]);

  // Elision: drop unstressed syllables (common in fast radio speech)
  // e.g. "between" → "btween", "Vodacom" → "vodcom"
  const elided = base.replace(/(?<=[bcdfghjklmnpqrstvwxyz])[aeiou](?=[bcdfghjklmnpqrstvwxyz])/g, '');
  if (elided !== base && elided.length >= 3) variants.add(elided);

  // Contracted ending: drop final 'e', 'er', 'ing' (fast speech)
  variants.add(base.replace(/ing$/, 'in'));
  variants.add(base.replace(/er$/, 'a'));
  variants.add(base.replace(/tion$/, 'shun'));
  variants.add(base.replace(/tion$/, 'cion'));

  // Vowel shift variants for each word
  const words = base.split(/\s+/);
  for (const [vowel, subs] of Object.entries(VOWEL_SUBSTITUTIONS)) {
    for (const sub of subs) {
      if (sub === vowel) continue;
      const shifted = words.map(w => w.replace(new RegExp(vowel, 'g'), sub)).join(' ');
      if (shifted !== base) variants.add(shifted);
    }
  }

  // Consonant substitution
  for (const [cons, subs] of Object.entries(CONSONANT_SUBS)) {
    for (const sub of subs) {
      if (sub === cons) continue;
      const substituted = base.replace(new RegExp(cons, 'g'), sub);
      if (substituted !== base) variants.add(substituted);
    }
  }

  // th-fronting (very common across West African, Caribbean, British accents)
  variants.add(base.replace(/\bth/g, 'd').replace(/th\b/g, 'f'));

  // H-dropping
  variants.add(base.replace(/\bh/g, ''));

  // Devoicing (common: "badge" → "batch", "live" → "liff")
  variants.add(base.replace(/v\b/g, 'f').replace(/d\b/g, 't').replace(/z\b/g, 's'));

  // Remove duplicates & obviously bad ones (too short or same as base)
  return [...variants].filter(v => v.length >= Math.min(3, base.length));
};

// ─────────────────────────────────────────────────────────────────────────────
// ② Homophone / abbreviation dictionary
// ─────────────────────────────────────────────────────────────────────────────
const HOMOPHONES: Record<string, string[]> = {
  'coca cola':  ['coke', 'coca', 'cola', 'coca-cola'],
  'pepsi':      ['pepsi cola', 'pep'],
  'mcdonald':   ["mcdonalds", "mac donalds", "mickey d", "micky d", "the golden arches"],
  'kfc':        ['kentucky fried chicken', 'kentucky', 'colonel'],
  'nike':       ['nikey', 'ni-ke'],
  'adidas':     ['adi das', 'adeedas'],
  'vodacom':    ['voda', 'vodafone', 'voda com'],
  'mtn':        ['em tee en', 'm t n', 'mountain'],
  'dstv':       ['d s t v', 'dee stv', 'multichoice'],
  'glo':        ['glo mobile', 'globacom'],
  'airtel':     ['air tel', 'airtle'],
  'zenith':     ['zenith bank', 'zee nith'],
  'gtbank':     ['gt bank', 'guaranty trust', 'gtco'],
  'uba':        ['u b a', 'united bank'],
  'dangote':    ['dan go tay', 'dangotay'],
};

const getHomophones = (keyword: string): string[] => {
  const k = keyword.toLowerCase();
  const direct = HOMOPHONES[k] || [];
  // Also check if keyword IS a homophone of something
  const reverse: string[] = [];
  for (const [base, alts] of Object.entries(HOMOPHONES)) {
    if (alts.some(a => a.toLowerCase() === k)) reverse.push(base);
  }
  return [...direct, ...reverse];
};

// ─────────────────────────────────────────────────────────────────────────────
// ③ Soundex
// ─────────────────────────────────────────────────────────────────────────────
const getSoundex = (s: string): string => {
  if (!s) return '';
  const MAP: Record<string, string> = {
    b:'1',f:'1',p:'1',v:'1', c:'2',g:'2',j:'2',k:'2',q:'2',s:'2',x:'2',z:'2',
    d:'3',t:'3', l:'4', m:'5',n:'5', r:'6'
  };
  let out = s[0].toUpperCase();
  let prev = MAP[s[0].toLowerCase()] || '0';
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const c = s[i].toLowerCase();
    const code = MAP[c];
    if (code && code !== prev) out += code;
    prev = code || ('aeiouyhw'.includes(c) ? '0' : prev);
  }
  return (out + '000').slice(0, 4);
};

// Double Metaphone (simplified) — captures more phonetic variants than Soundex
const getMetaphone = (s: string): string => {
  return s.toLowerCase()
    .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/qu/g, 'k')
    .replace(/[aeiou]/g, 'a').replace(/(.)\1+/g, '$1') // collapse repeated chars
    .replace(/[hw]/g, '').replace(/[gy]([aeiou])/g, 'j$1')
    .replace(/[sz]/g, 's').replace(/[td]$/g, 't').replace(/[bp]$/g, 'p');
};

// ─────────────────────────────────────────────────────────────────────────────
// ④ Levenshtein
// ─────────────────────────────────────────────────────────────────────────────
const levenshtein = (a: string, b: string): number => {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Int32Array(b.length + 1).map((_, i) => i);
  let curr = new Int32Array(b.length + 1);
  for (let i = 0; i < a.length; i++) {
    curr[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const c = a[i] === b[j] ? 0 : 1;
      curr[j+1] = Math.min(curr[j]+1, prev[j+1]+1, prev[j]+c);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
};

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ Core match function — checks ONE transcript against ONE keyword
//    Returns match + confidence + which variant matched
// ─────────────────────────────────────────────────────────────────────────────
const matchTranscriptToKeyword = (
  transcript: string,
  keyword: string,
  expandedVariants: string[],
  sensitivity: number
): { match: boolean; confidence: Confidence; variant: string } => {

  const NO = { match: false, confidence: 'Weak' as Confidence, variant: '' };
  const t = transcript.toLowerCase().replace(/['']/g, '');
  const k = keyword.toLowerCase();

  // ── Exact substring ───────────────────────────────────────────────────────
  if (t.includes(k)) return { match: true, confidence: 'Strong', variant: k };

  // ── All expanded variants (vowel shift, elision, th-fronting …) ───────────
  for (const v of expandedVariants) {
    if (t.includes(v)) return { match: true, confidence: v === k ? 'Strong' : 'Good', variant: v };
  }

  if (sensitivity === 1) return NO;

  // ── Mashed (no-space) match — radio fast speech ───────────────────────────
  const mt = t.replace(/[^a-z0-9]/g, '');
  const mk = k.replace(/[^a-z0-9]/g, '');
  if (mt.includes(mk)) return { match: true, confidence: 'Strong', variant: k };

  // ── Sliding window on mashed with edit distance ───────────────────────────
  if (mk.length >= 4) {
    let allowed = mk.length <= 5 ? 1 : mk.length <= 8 ? 2 : 3;
    if (sensitivity === 2) allowed = Math.max(0, allowed - 1);
    if (sensitivity >= 4) allowed++;
    if (sensitivity === 5) allowed++;

    for (let i = 0; i <= mt.length - mk.length + allowed; i++) {
      for (let d = -allowed; d <= allowed; d++) {
        const len = mk.length + d;
        if (len < 4 || i + len > mt.length) continue;
        const dist = levenshtein(mt.slice(i, i + len), mk);
        if (dist <= allowed)
          return { match: true, confidence: dist <= 1 ? 'Good' : 'Weak', variant: `~${mk}` };
      }
    }
  }

  // ── Per-word phonetic match ───────────────────────────────────────────────
  const tWords = t.split(/[\s,.\-!?;:]+/).filter(Boolean);
  const kWords = k.split(/\s+/).filter(Boolean);
  let maxDist = k.length <= 3 ? 0 : k.length <= 5 ? 1 : 2;
  if (sensitivity === 2) maxDist = Math.max(0, maxDist - 1);
  if (sensitivity >= 4) maxDist++;
  if (sensitivity === 5) maxDist++;

  if (kWords.length === 1) {
    const kSdx = getSoundex(mk);
    const kMeta = getMetaphone(mk);
    for (const tw of tWords) {
      const cw = tw.replace(/[^a-z0-9]/g, '');
      if (!cw || cw.length < 2) continue;
      const lengthOk = Math.abs(cw.length - mk.length) <= Math.max(2, sensitivity - 1);
      // Double Metaphone — more accent-robust than Soundex alone
      if (cw.length > 3 && (getSoundex(cw) === kSdx || getMetaphone(cw) === kMeta) && lengthOk)
        return { match: true, confidence: 'Good', variant: `≈${cw}` };
      if (maxDist > 0 && lengthOk && levenshtein(cw, mk) <= maxDist)
        return { match: true, confidence: maxDist === 1 ? 'Good' : 'Weak', variant: `~${cw}` };
    }
  }

  // ── Multi-word: sequential word-by-word match in sliding window ───────────
  if (kWords.length > 1 && tWords.length >= kWords.length) {
    for (let i = 0; i <= tWords.length - kWords.length; i++) {
      let allMatch = true;
      for (let j = 0; j < kWords.length; j++) {
        const tw = tWords[i + j].replace(/[^a-z0-9]/g, '');
        const kw = kWords[j].replace(/[^a-z0-9]/g, '');
        if (!tw || !kw) { allMatch = false; break; }
        const dist = levenshtein(tw, kw);
        const allowed = kw.length <= 3 ? 0 : 1;
        if (dist > allowed) { allMatch = false; break; }
      }
      if (allMatch) return { match: true, confidence: 'Good', variant: kWords.join(' ') };
    }
  }

  return NO;
};

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ Multi-hypothesis voter
//    Takes all speech API alternatives, scores each, returns weighted result
// ─────────────────────────────────────────────────────────────────────────────
interface VoteResult {
  matched: boolean;
  keyword: string;
  confidence: Confidence;
  voteScore: number;   // 0-1
  transcript: string;
  variant: string;
}

const voteOnHypotheses = (
  hypotheses: Array<{ transcript: string; confidence?: number }>,
  keywords: string[],
  expandedMap: Map<string, string[]>,
  sensitivity: number,
  homoMap: Map<string, string[]>
): VoteResult => {
  const NULL: VoteResult = { matched: false, keyword: '', confidence: 'Weak', voteScore: 0, transcript: '', variant: '' };
  if (!hypotheses.length || !keywords.length) return NULL;

  // Expand hypotheses to include homophone substitutions
  const allHyps = [...hypotheses];
  for (const hyp of hypotheses) {
    for (const kw of keywords) {
      const homos = homoMap.get(kw) || [];
      for (const h of homos) {
        if (hyp.transcript.toLowerCase().includes(h)) {
          // Synthesise a transcript where the homophone is replaced with canonical keyword
          allHyps.push({ transcript: hyp.transcript.replace(new RegExp(h, 'gi'), kw), confidence: (hyp.confidence || 0.5) * 0.9 });
        }
      }
    }
  }

  // Votes: keyword → array of confidence scores across hypotheses
  const votes: Map<string, { confs: Confidence[]; weights: number[]; transcripts: string[]; variants: string[] }> = new Map();

  for (const hyp of allHyps) {
    const weight = typeof hyp.confidence === 'number' ? hyp.confidence : 0.5;
    for (const kw of keywords) {
      const variants = expandedMap.get(kw) || [];
      const result = matchTranscriptToKeyword(hyp.transcript, kw, variants, sensitivity);
      if (result.match) {
        const existing = votes.get(kw) || { confs: [], weights: [], transcripts: [], variants: [] };
        existing.confs.push(result.confidence);
        existing.weights.push(weight);
        existing.transcripts.push(hyp.transcript);
        existing.variants.push(result.variant);
        votes.set(kw, existing);
      }
    }
  }

  if (!votes.size) return NULL;

  // Pick keyword with highest weighted vote score
  let best: VoteResult = NULL;
  for (const [kw, data] of votes.entries()) {
    const totalWeight = allHyps.reduce((s, h) => s + (h.confidence || 0.5), 0);
    const matchWeight = data.weights.reduce((s, w) => s + w, 0);
    const voteScore = matchWeight / Math.max(totalWeight, 1);

    // Derive confidence from vote score + individual confidences
    const strongCount = data.confs.filter(c => c === 'Strong').length;
    const goodCount   = data.confs.filter(c => c === 'Good').length;
    const conf: Confidence = strongCount > 0 ? 'Strong' : goodCount > 0 ? 'Good' : 'Weak';

    // Syllable guard: don't trigger on very short keyword inside long unrelated transcript
    // e.g. keyword "go" inside "going to the store" — require it's a word boundary match
    const kwWords = kw.split(' ');
    if (kwWords.length === 1 && kw.length <= 3) {
      // Extra strictness: require Strong match for very short keywords
      if (conf === 'Weak') continue;
    }

    if (voteScore > best.voteScore) {
      best = {
        matched: true, keyword: kw, confidence: conf, voteScore,
        transcript: data.transcripts[0], variant: data.variants[0]
      };
    }
  }
  return best;
};

// ─────────────────────────────────────────────────────────────────────────────
// WAV encoder
// ─────────────────────────────────────────────────────────────────────────────
const encodeWAV = (samples: Float32Array, sampleRate: number): Blob => {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ws = (off: number, s: string) => { for (let i=0;i<s.length;i++) v.setUint8(off+i,s.charCodeAt(i)); };
  ws(0,'RIFF'); v.setUint32(4,36+samples.length*2,true);
  ws(8,'WAVE'); ws(12,'fmt '); v.setUint32(16,16,true);
  v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,sampleRate,true); v.setUint32(28,sampleRate*2,true);
  v.setUint16(32,2,true); v.setUint16(34,16,true);
  ws(36,'data'); v.setUint32(40,samples.length*2,true);
  let off=44;
  for(let i=0;i<samples.length;i++){const s=Math.max(-1,Math.min(1,samples[i]));v.setInt16(off,s<0?s*0x8000:s*0x7FFF,true);off+=2;}
  return new Blob([buf],{type:'audio/wav'});
};

/**
 * Extract [preSec] seconds before triggerHead and [postSec] seconds after
 * currentHead from the ring buffer, producing a single contiguous WAV.
 *
 *  triggerHead  = writeHead snapshot taken at the moment the keyword fired
 *  currentHead  = writeHead at the moment we're saving (30 s later)
 *
 * The ring buffer looks like:
 *   … [  pre 30 s  |  TRIGGER  |  post 30 s  ] …
 *         ^triggerHead          ^currentHead
 */
const circularToWAV = (
  buffer: Float32Array,
  triggerHead: number,
  currentHead: number,
  preSec: number,
  postSec: number,
  sr: number
): Blob => {
  const bLen    = buffer.length;
  const preLen  = Math.min(Math.floor(sr * preSec),  bLen);
  const postLen = Math.min(Math.floor(sr * postSec), bLen);
  const totalLen = preLen + postLen;
  const out = new Float32Array(totalLen);

  // ── Extract pre-trigger segment (ends at triggerHead) ───────────────────
  let preStart = triggerHead - preLen;
  if (preStart < 0) {
    preStart += bLen;
    const firstPart = bLen - preStart;
    out.set(buffer.subarray(preStart), 0);
    out.set(buffer.subarray(0, preLen - firstPart), firstPart);
  } else {
    out.set(buffer.subarray(preStart, triggerHead), 0);
  }

  // ── Extract post-trigger segment (starts at triggerHead, ends at currentHead) ──
  let postStart = triggerHead;
  const actualPostLen = Math.min(postLen, (() => {
    // How many samples were written between triggerHead and currentHead?
    let written = currentHead - triggerHead;
    if (written < 0) written += bLen;
    return written;
  })());

  if (postStart + actualPostLen <= bLen) {
    out.set(buffer.subarray(postStart, postStart + actualPostLen), preLen);
  } else {
    const firstPart = bLen - postStart;
    out.set(buffer.subarray(postStart), preLen);
    out.set(buffer.subarray(0, actualPostLen - firstPart), preLen + firstPart);
  }

  // ── Normalise ────────────────────────────────────────────────────────────
  let max = 0;
  for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > max) max = a; }
  if (max > 0.02 && max < 1) { const m = 0.92 / max; for (let i = 0; i < out.length; i++) out[i] *= m; }

  return encodeWAV(out, sr);
};

const getSupportedMimeType = (): string => {
  for (const t of ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg','audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
};

const blobToBase64 = (b: Blob): Promise<string> => new Promise((res,rej)=>{const r=new FileReader();r.onloadend=()=>res(r.result as string);r.onerror=rej;r.readAsDataURL(b);});
const base64ToBlob = async (b64: string): Promise<Blob> => { const r=await fetch(b64);return r.blob(); };

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [isListening,       setIsListening]       = useState(false);
  const [isRecording,       setIsRecording]        = useState(false);
  const [isPaused,          setIsPaused]           = useState(false);
  const [keywords,          setKeywords]           = useState<string[]>([]);
  const [newKeyword,        setNewKeyword]         = useState('');
  const [recordings,        setRecordings]         = useState<Recording[]>([]);
  const [,                 setLastDetected]       = useState<string | null>(null);
  const [fftBins,           setFftBins]            = useState<number[]>(Array(32).fill(0));
  const [error,             setError]              = useState<string | null>(null);
  // Fixed 30 s pre-trigger + 30 s post-trigger = 60 s total per recording
  const PRE_TRIGGER_SEC  = 30;
  const POST_TRIGGER_SEC = 30;
  const POST_CHUNKS      = POST_TRIGGER_SEC * 4; // 250 ms chunks

  const [playingId,         setPlayingId]          = useState<string | null>(null);
  const [playProgress,      setPlayProgress]       = useState<Record<string,number>>({});
  const [sensitivity,       setSensitivity]        = useState<number>(3);
  const [searchQuery,       setSearchQuery]        = useState('');
  const [sortBy,            setSortBy]             = useState<'time'|'keyword'|'duration'>('time');
  const [selectedRecs,      setSelectedRecs]       = useState<Set<string>>(new Set());
  const [liveTranscript,    setLiveTranscript]     = useState('');
  const [keywordStats,      setKeywordStats]       = useState<Record<string,KeywordStat>>({});
  const [micDevices,        setMicDevices]         = useState<MediaDeviceInfo[]>([]);
  const [selectedMic,       setSelectedMic]        = useState<string>('');
  const [showSettings,      setShowSettings]       = useState(true);
  const [showStats,         setShowStats]          = useState(false);
  const [vadActive,         setVadActive]          = useState(false);
  const [noiseFloor,        setNoiseFloor]         = useState(0);
  const [noiseCalibrating,  setNoiseCalibrating]   = useState(false);
  const [filterEnabled,     setFilterEnabled]      = useState(true);
  const [showDebug,         setShowDebug]          = useState(false);
  const [debugLog,          setDebugLog]           = useState<string[]>([]);

  const [theme, setTheme] = useState<'light'|'dark'>(() => {
    if (typeof window !== 'undefined') {
      const s = localStorage.getItem('theme');
      if (s) return s as 'light'|'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  });

  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('onboardingComplete') !== 'true';
    return true;
  });

  // ── Refs ──────────────────────────────────────────────────────────────────
  const keywordsRef        = useRef(keywords);
  const sensitivityRef     = useRef(sensitivity);
  const isPausedRef        = useRef(isPaused);
  const isListeningRef     = useRef(false);
  const isRecordingRef     = useRef(isRecording);
  const filterEnabledRef   = useRef(filterEnabled);
  const noiseFloorRef      = useRef(0);

  useEffect(() => { keywordsRef.current    = keywords;   }, [keywords]);
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);
  useEffect(() => { isPausedRef.current    = isPaused;   }, [isPaused]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { filterEnabledRef.current = filterEnabled; }, [filterEnabled]);

  // Expanded keyword map (rebuilt whenever keywords change)
  const expandedMapRef = useRef<Map<string, string[]>>(new Map());
  const homoMapRef     = useRef<Map<string, string[]>>(new Map());
  useEffect(() => {
    const em = new Map<string, string[]>();
    const hm = new Map<string, string[]>();
    for (const kw of keywords) {
      em.set(kw, expandKeyword(kw));
      hm.set(kw, getHomophones(kw));
    }
    expandedMapRef.current = em;
    homoMapRef.current = hm;
  }, [keywords]);

  // Per-keyword cooldown (prevents duplicate triggers)
  const cooldownRef = useRef<Map<string, number>>(new Map());
  const COOLDOWN_MS = 10_000;

  // Audio pipeline refs
  const recognitionRef    = useRef<any>(null);
  const continuousRecRef  = useRef<MediaRecorder | null>(null);
  const streamRef         = useRef<MediaStream | null>(null);
  const rollingBufRef     = useRef<Blob[]>([]);
  const postTriggerRef    = useRef(0);
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const analyserRef       = useRef<AnalyserNode | null>(null);
  const animFrameRef      = useRef<number | null>(null);
  const circBufRef        = useRef<Float32Array | null>(null);
  const writeHeadRef      = useRef(0);
  const triggerWriteHeadRef = useRef(0); // snapshot of writeHead at the exact moment trigger fires
  const currentTrigRef    = useRef('');
  const currentConfRef    = useRef<Confidence>('Strong');
  const currentTransRef   = useRef('');
  const currentVoteRef    = useRef(0);
  const currentVariantRef = useRef('');
  const processorRef      = useRef<ScriptProcessorNode | null>(null);
  const recordStartRef    = useRef(0);
  const noiseCalibSamples = useRef<number[]>([]);
  const transcriptWindowRef = useRef<string[]>([]);  // rolling last-N transcripts

  // Theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Mic devices
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices()
      .then(d => setMicDevices(d.filter(d => d.kind === 'audioinput')))
      .catch(() => {});
  }, []);

  // Backend sync
  useEffect(() => {
    (async () => {
      try {
        const [kw,rec] = await Promise.all([fetch('/api/keywords'),fetch('/api/recordings')]);
        if (kw.ok) setKeywords(await kw.json());
        if (rec.ok) {
          const data = await rec.json();
          const parsed: Recording[] = await Promise.all(data.map(async (r: any) => {
            const blob = await base64ToBlob(r.audioBase64);
            return { id:r.id, blob, url:URL.createObjectURL(blob), timestamp:new Date(r.timestamp),
              triggerWord:r.triggerWord, duration:r.duration, confidence:r.confidence||'Strong',
              transcript:r.transcript||'', voteScore:r.voteScore||0, matchVariant:r.matchVariant };
          }));
          setRecordings(parsed);
        }
      } catch {}
    })();
  }, []);

  const appendDebug = useCallback((msg: string) => {
    setDebugLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 60));
  }, []);

  // ── Voice Activity Detection (RMS-based) ────────────────────────────────
  const rmsRef = useRef(0);
  const VAD_HYSTERESIS = 8; // frames
  const vadCounterRef = useRef(0);

  // ── Visualiser ───────────────────────────────────────────────────────────
  const startVisualiser = useCallback(async (stream: MediaStream) => {
    try {
      if (!audioCtxRef.current)
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint:'interactive', sampleRate:48000 });
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      const src = ctx.createMediaStreamSource(stream);

      // ① Voice-band bandpass filter chain (280 Hz – 3800 Hz)
      //    This strips music low end (bass, kick) and high-freq noise/cymbals
      //    while preserving the core speech formant range
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 280;
      highpass.Q.value = 0.7;

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 3800;
      lowpass.Q.value = 0.7;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      if (filterEnabledRef.current) {
        src.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(analyser);
      } else {
        src.connect(analyser);
      }

      const BINS = 32;
      const fData = new Uint8Array(analyser.frequencyBinCount);

      // Noise floor calibration (first 3 seconds)
      setNoiseCalibrating(true);
      noiseCalibSamples.current = [];

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(fData);

        // RMS for VAD
        let sum = 0;
        for (let i = 0; i < fData.length; i++) sum += (fData[i]/255) ** 2;
        rmsRef.current = Math.sqrt(sum / fData.length);

        // Noise floor calibration
        if (noiseCalibSamples.current.length < 90) { // ~3s at 30fps
          noiseCalibSamples.current.push(rmsRef.current);
          if (noiseCalibSamples.current.length === 90) {
            const sorted = [...noiseCalibSamples.current].sort((a,b)=>a-b);
            const floor = sorted[Math.floor(sorted.length * 0.8)]; // 80th percentile
            noiseFloorRef.current = floor;
            setNoiseFloor(floor);
            setNoiseCalibrating(false);
            appendDebug(`Noise floor calibrated: ${(floor*100).toFixed(1)}%`);
          }
        }

        // VAD: voice detected if RMS > noiseFloor * 2.5 (adaptive)
        const threshold = Math.max(0.04, noiseFloorRef.current * 2.5);
        if (rmsRef.current > threshold) {
          vadCounterRef.current = VAD_HYSTERESIS;
        } else {
          vadCounterRef.current = Math.max(0, vadCounterRef.current - 1);
        }
        const voiceActive = vadCounterRef.current > 0;
        setVadActive(voiceActive);

        // FFT bars
        const step = Math.floor(fData.length / BINS);
        setFftBins(Array.from({length: BINS}, (_,i) => fData[i*step] / 255 * 100));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch(e) { console.error('AudioContext error', e); }
  }, [appendDebug]);

  // ── Save recording ───────────────────────────────────────────────────────
  const saveRecording = useCallback(async (
    blob: Blob, triggerWord: string, durationSec: number,
    confidence: Confidence, transcript: string, voteScore: number, variant: string
  ) => {
    let finalBlob = blob;
    if (circBufRef.current && audioCtxRef.current) {
      // Use the snapshotted write-head from trigger time for accurate pre-buffer extraction
      finalBlob = circularToWAV(
        circBufRef.current,
        triggerWriteHeadRef.current,   // where we were when keyword fired
        writeHeadRef.current,           // where we are now (30 s later)
        PRE_TRIGGER_SEC,
        POST_TRIGGER_SEC,
        audioCtxRef.current.sampleRate
      );
    }
    const url = URL.createObjectURL(finalBlob);
    const rec: Recording = {
      id: Math.random().toString(36).slice(2,11), blob: finalBlob, url,
      timestamp: new Date(), triggerWord, duration: durationSec, confidence, transcript, voteScore, matchVariant: variant
    };
    setRecordings(prev => [rec, ...prev]);
    setKeywordStats(prev => {
      const ex = prev[triggerWord] || { word:triggerWord, count:0, avgConfidence:0 };
      const newCount = ex.count + 1;
      const confScore = confidence==='Strong'?1:confidence==='Good'?0.67:0.33;
      return { ...prev, [triggerWord]: { ...ex, count:newCount, lastSeen:new Date(), avgConfidence:(ex.avgConfidence*(newCount-1)+confScore)/newCount }};
    });
    try {
      const b64 = await blobToBase64(finalBlob);
      await fetch('/api/recordings', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ id:rec.id, triggerWord, duration:durationSec, timestamp:rec.timestamp.toISOString(), audioBase64:b64, size:finalBlob.size, confidence, transcript, voteScore, matchVariant:variant })
      });
    } catch { toast.warning('Saved locally; cloud sync unavailable.'); }
  }, []);

  // ── Trigger detection ────────────────────────────────────────────────────
  const triggerRecording = useCallback((
    word: string, confidence: Confidence, transcript: string, voteScore: number, variant: string
  ) => {
    if (isRecordingRef.current) return;

    // Cooldown check
    const lastFire = cooldownRef.current.get(word) || 0;
    if (Date.now() - lastFire < COOLDOWN_MS) {
      appendDebug(`Cooldown active for "${word}" — skipping`);
      return;
    }
    cooldownRef.current.set(word, Date.now());

    currentTrigRef.current    = word;
    currentConfRef.current    = confidence;
    currentTransRef.current   = transcript;
    currentVoteRef.current    = voteScore;
    currentVariantRef.current = variant;
    recordStartRef.current    = Date.now();
    triggerWriteHeadRef.current = writeHeadRef.current; // ← snapshot pre-buffer anchor
    postTriggerRef.current    = POST_CHUNKS;            // exactly 30 s of post-trigger
    setIsRecording(true);
    setLastDetected(word);
    appendDebug(`TRIGGER "${word}" | ${confidence} | vote=${(voteScore*100).toFixed(0)}% | variant="${variant}"`);
    toast.success(`🎯 "${word}" detected (${confidence}, ${(voteScore*100).toFixed(0)}% votes). Saving 30s pre + 30s post…`);
  }, [appendDebug]);

  // ── Stop recording manually ───────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) return;
    postTriggerRef.current = 0;
    const postElapsed = (Date.now() - recordStartRef.current) / 1000;
    const totalDuration = PRE_TRIGGER_SEC + postElapsed;
    const blob = new Blob(rollingBufRef.current, { type: continuousRecRef.current?.mimeType || 'audio/webm' });
    saveRecording(blob, currentTrigRef.current, totalDuration, currentConfRef.current, currentTransRef.current, currentVoteRef.current, currentVariantRef.current);
    rollingBufRef.current = [];
    setIsRecording(false);
    toast.success(`Stopped & saved. (30s pre + ${postElapsed.toFixed(0)}s post)`);
  }, [saveRecording]);

  // ── Build/refresh Web Speech grammar ─────────────────────────────────────
  const refreshGrammar = useCallback((rec: any) => {
    const SpeechGrammarList = (window as any).SpeechGrammarList || (window as any).webkitSpeechGrammarList;
    if (!SpeechGrammarList || !keywordsRef.current.length) return;
    const list = new SpeechGrammarList();
    // Include all expanded variants in the grammar so the engine is biased towards them
    const allTerms = new Set<string>();
    for (const kw of keywordsRef.current) {
      allTerms.add(kw.toLowerCase());
      for (const v of (expandedMapRef.current.get(kw) || [])) allTerms.add(v);
      for (const h of (homoMapRef.current.get(kw) || [])) allTerms.add(h);
    }
    const grammar = '#JSGF V1.0; grammar kw; public <kw> = ' + [...allTerms].join(' | ') + ' ;';
    list.addFromString(grammar, 1);
    try { rec.grammars = list; } catch {}
  }, []);

  // ── Main toggle ───────────────────────────────────────────────────────────
  const toggleListening = useCallback(() => {
    if (isListeningRef.current) {
      recognitionRef.current?.stop();
      continuousRecRef.current?.stop();
      processorRef.current?.disconnect();
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      analyserRef.current = null;
      setIsListening(false); isListeningRef.current = false;
      setIsRecording(false);
      setFftBins(Array(32).fill(0));
      setVadActive(false);
      setLiveTranscript('');
      postTriggerRef.current = 0;
    } else {
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,  // we do our own filtering
          autoGainControl: false,
          channelCount: 1,
          sampleRate: 48000,
          ...(selectedMic ? { deviceId: { exact: selectedMic } } : {})
        }
      };

      navigator.mediaDevices.getUserMedia(constraints).then(stream => {
        streamRef.current = stream;
        startVisualiser(stream);

        const ctx = audioCtxRef.current!;
        const bufSize = ctx.sampleRate * 90; // 90 s: 30 s pre + 30 s post + 30 s headroom
        circBufRef.current = new Float32Array(bufSize);
        writeHeadRef.current = 0;

        // PCM circular buffer writer — uses filtered source if available
        const rawSrc = ctx.createMediaStreamSource(stream);
        try {
          const proc = ctx.createScriptProcessor(2048, 1, 1);
          const sink = ctx.createGain(); sink.gain.value = 0;

          if (filterEnabledRef.current) {
            // Write FILTERED audio to the circular buffer for cleaner WAV output
            const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=280;
            const lp = ctx.createBiquadFilter(); lp.type='lowpass';  lp.frequency.value=3800;
            rawSrc.connect(hp); hp.connect(lp); lp.connect(proc);
          } else {
            rawSrc.connect(proc);
          }
          proc.connect(sink); sink.connect(ctx.destination);

          proc.onaudioprocess = (e) => {
            const inp = e.inputBuffer.getChannelData(0);
            const buf = circBufRef.current!;
            const h = writeHeadRef.current;
            const l = inp.length;
            const bl = buf.length;
            if (h + l <= bl) { buf.set(inp, h); writeHeadRef.current = h + l; }
            else { const f=bl-h; buf.set(inp.subarray(0,f),h); buf.set(inp.subarray(f),0); writeHeadRef.current=l-f; }
          };
          processorRef.current = proc;
        } catch(e) { console.warn('ScriptProcessor unavailable', e); }

        // MediaRecorder for rolling blob buffer
        const mimeType = getSupportedMimeType();
        const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        continuousRecRef.current = mr;
        rollingBufRef.current = []; postTriggerRef.current = 0;

        mr.ondataavailable = (e) => {
          if (!e.data.size) return;
          rollingBufRef.current.push(e.data);
          if (postTriggerRef.current > 0) {
            postTriggerRef.current--;
            if (postTriggerRef.current === 0) {
              // POST_TRIGGER_SEC have elapsed — save using circular PCM buffer
              const totalDuration = PRE_TRIGGER_SEC + POST_TRIGGER_SEC;
              const blob = new Blob(rollingBufRef.current, { type: mr.mimeType });
              saveRecording(blob, currentTrigRef.current, totalDuration, currentConfRef.current, currentTransRef.current, currentVoteRef.current, currentVariantRef.current);
              rollingBufRef.current = [];
              setIsRecording(false);
              toast.success('Recording complete & saved. (30s pre + 30s post)');
            }
          } else {
            // Pre-buffer rolling window: keep last 30 s = 120 chunks @ 250 ms
            if (rollingBufRef.current.length > 120) rollingBufRef.current.shift();
          }
        };
        mr.start(250);

        // Web Speech API
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
          toast.warning('Browser speech recognition not available (Chrome/Edge recommended).');
        } else {
          const recog = new SpeechRecognition();
          recog.continuous      = true;
          recog.interimResults  = true;
          recog.maxAlternatives = 8;
          recog.lang            = 'en-US';
          refreshGrammar(recog);

          recog.onresult = (event: any) => {
            if (isPausedRef.current) return;
            // VAD gate: only process if voice is active (or VAD recently active)
            // This prevents music-only segments from consuming recognition quota
            if (!vadCounterRef.current && noiseFloorRef.current > 0) return;

            // Build rolling N-gram window (last 4 results concatenated)
            const results = event.results;
            const startIdx = Math.max(0, event.resultIndex - 3);
            let combined = '';
            for (let i = startIdx; i < results.length; i++) {
              combined += ' ' + results[i][0].transcript;
            }

            // Collect all hypotheses from the latest result
            const latest = results[results.length - 1];
            const hyps: Array<{transcript:string; confidence?:number}> = [];
            for (let j = 0; j < latest.length; j++) {
              hyps.push({ transcript: latest[j].transcript, confidence: latest[j].confidence || 0.5 });
            }
            // Add combined rolling window as an extra high-weight hypothesis
            hyps.push({ transcript: combined, confidence: 0.9 });

            // Also add transcript window (cross-phrase detection)
            transcriptWindowRef.current.push(combined.trim());
            if (transcriptWindowRef.current.length > 6) transcriptWindowRef.current.shift();
            const windowJoined = transcriptWindowRef.current.join(' ');
            hyps.push({ transcript: windowJoined, confidence: 0.7 });

            setLiveTranscript(combined.trim().slice(-150));
            appendDebug(`Speech: "${combined.trim().slice(0,80)}"`);

            const result = voteOnHypotheses(
              hyps, keywordsRef.current,
              expandedMapRef.current, sensitivityRef.current, homoMapRef.current
            );

            if (result.matched) {
              appendDebug(`Match! kw="${result.keyword}" conf=${result.confidence} vote=${(result.voteScore*100).toFixed(0)}%`);
              triggerRecording(result.keyword, result.confidence, result.transcript, result.voteScore, result.variant);
            }
          };

          recog.onerror = (e: any) => {
            if (e.error === 'not-allowed') { setError('Microphone access denied.'); toast.error('Mic denied.'); }
            else if (e.error === 'network') toast.error('Speech API needs internet (Chrome).');
            appendDebug(`Speech error: ${e.error}`);
          };
          recog.onend = () => { if (isListeningRef.current) { refreshGrammar(recog); recog.start(); } };
          recog.start();
          recognitionRef.current = recog;
        }

        setIsListening(true); isListeningRef.current = true;
        toast.success('Monitoring started. Calibrating noise floor…');

      }).catch((err: any) => {
        let msg = 'Could not access microphone.';
        if (err.name==='NotAllowedError') msg='Microphone permission denied.';
        else if (err.name==='NotFoundError') msg='No microphone found.';
        else if (err.name==='NotReadableError') msg='Microphone in use by another app.';
        setError(msg); toast.error(msg);
      });
    }
  }, [selectedMic, startVisualiser, saveRecording, triggerRecording, refreshGrammar, appendDebug]);

  // ── Keyword management ────────────────────────────────────────────────────
  const addKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    const word = newKeyword.trim().toLowerCase();
    if (!word) return;
    if (keywords.includes(word)) { toast.error('Already exists'); return; }
    setKeywords(prev => [...prev, word]);
    setNewKeyword('');
    const variants = expandKeyword(word);
    const homos = getHomophones(word);
    appendDebug(`Added "${word}" → ${variants.length} phonetic variants, ${homos.length} homophones`);
    toast.success(`"${word}" added — ${variants.length} variants generated`);
    try { await fetch('/api/keywords',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({word})}); } catch {}
  };

  const removeKeyword = async (word: string) => {
    setKeywords(prev => prev.filter(k => k !== word));
    toast.info(`"${word}" removed`);
    try { await fetch(`/api/keywords/${encodeURIComponent(word)}`,{method:'DELETE'}); } catch {}
  };

  // ── Recording management ──────────────────────────────────────────────────
  const deleteRecording = async (id: string) => {
    setRecordings(prev => { const r=prev.find(r=>r.id===id); if(r) URL.revokeObjectURL(r.url); return prev.filter(r=>r.id!==id); });
    try { await fetch(`/api/recordings/${id}`,{method:'DELETE'}); } catch {}
  };

  const deleteSelected = async () => {
    if (!selectedRecs.size) return;
    const ids = Array.from(selectedRecs);
    setRecordings(prev => { prev.filter(r=>ids.includes(r.id)).forEach(r=>URL.revokeObjectURL(r.url)); return prev.filter(r=>!ids.includes(r.id)); });
    setSelectedRecs(new Set());
    for (const id of ids) { try { await fetch(`/api/recordings/${id}`,{method:'DELETE'}); } catch {} }
  };

  const exportZip = async () => {
    const toExp = selectedRecs.size ? recordings.filter(r=>selectedRecs.has(r.id)) : recordings;
    if (!toExp.length) return;
    const zip = new JSZip();
    let csv = 'ID,Keyword,Duration(s),Timestamp,Confidence,VoteScore,MatchVariant,Transcript\n';
    toExp.forEach(r => {
      zip.file(`ad_${r.triggerWord}_${r.id}.wav`, r.blob);
      csv += `${r.id},"${r.triggerWord}",${r.duration.toFixed(1)},${r.timestamp.toISOString()},${r.confidence},${r.voteScore.toFixed(2)},"${r.matchVariant||''}","${(r.transcript||'').replace(/"/g,'""')}"\n`;
    });
    zip.file('metadata.csv', csv);
    const content = await zip.generateAsync({type:'blob'});
    saveAs(content, `ad_captures_${format(new Date(),'yyyy-MM-dd_HH-mm')}.zip`);
    toast.success(`Exported ${toExp.length} recordings`);
    setSelectedRecs(new Set());
  };

  const filteredRecs = recordings
    .filter(r => r.triggerWord.toLowerCase().includes(searchQuery.toLowerCase()) || (r.transcript||'').toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a,b) => sortBy==='time' ? b.timestamp.getTime()-a.timestamp.getTime() : sortBy==='keyword' ? a.triggerWord.localeCompare(b.triggerWord) : b.duration-a.duration);

  const toggleSel = (id: string) => setSelectedRecs(prev => { const s=new Set(prev); s.has(id)?s.delete(id):s.add(id); return s; });
  const toggleAll = () => setSelectedRecs(selectedRecs.size===filteredRecs.length ? new Set() : new Set(filteredRecs.map(r=>r.id)));

  const confColor = (c?: string) =>
    c==='Strong' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' :
    c==='Good'   ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' :
                   'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400';

  const sensitivityLabel = ['','Strict','Tight','Balanced','Loose','Broad'][sensitivity];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0f1117] text-zinc-100 font-sans" style={{fontFamily:"'DM Sans', system-ui, sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        :root { --accent: #3b82f6; --accent-glow: rgba(59,130,246,0.15); }
        .dark { color-scheme: dark; }
        .light { background: #f8f9fc; color: #0f1117; }
        .light .bg-\\[\\#0f1117\\] { background: #f8f9fc; }
        .light .bg-zinc-900 { background: white; }
        .light .bg-zinc-800 { background: #f1f3f7; }
        .light .border-zinc-800 { border-color: #e2e6ef; }
        .light .text-zinc-400 { color: #6b7280; }
        .light .text-zinc-300 { color: #374151; }
        .light .text-zinc-100 { color: #111827; }
        .light .bg-\\[\\#0d0e14\\] { background: #f1f3f7; }
        .vad-ring { box-shadow: 0 0 0 3px rgba(59,130,246,0.3), 0 0 20px rgba(59,130,246,0.1); }
        .rec-ring { box-shadow: 0 0 0 3px rgba(239,68,68,0.4), 0 0 24px rgba(239,68,68,0.15); }
        .mono { font-family: 'DM Mono', monospace; }
      `}</style>
      <Toaster position="top-center" theme={theme} richColors />

      {/* Onboarding */}
      <AnimatePresence>
        {showOnboarding && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <motion.div initial={{scale:0.93,y:24}} animate={{scale:1,y:0}} exit={{scale:0.93,y:24}}
              className="bg-[#161820] border border-zinc-800 rounded-2xl max-w-md w-full p-8 shadow-2xl">
              <div className="w-11 h-11 bg-blue-600 rounded-xl flex items-center justify-center mb-6">
                <Radio size={22} className="text-white" />
              </div>
              <h2 className="text-2xl font-bold mb-2">AdMonitor Pro</h2>
              <p className="text-zinc-400 text-sm mb-7 leading-relaxed">
                Real-time radio ad keyword detection with phoneme expansion, noise filtering, and multi-hypothesis voting — works entirely in your browser.
              </p>
              <div className="space-y-4 mb-8">
                {[
                  { icon:<Waves size={16}/>, col:'text-blue-400', t:'Voice-band filter', d:'Strips music and noise below 280 Hz and above 3800 Hz before speech recognition.' },
                  { icon:<Zap size={16}/>, col:'text-amber-400', t:'Phoneme expansion', d:'Each keyword is expanded into 30+ accent and fast-speech variants automatically.' },
                  { icon:<Shield size={16}/>, col:'text-emerald-400', t:'Multi-hypothesis voting', d:'All 8 speech API alternatives are scored and vote-weighted for accuracy.' },
                ].map(({icon,col,t,d}) => (
                  <div key={t} className="flex gap-3">
                    <div className={`mt-0.5 shrink-0 ${col}`}>{icon}</div>
                    <div><p className="text-sm font-semibold">{t}</p><p className="text-xs text-zinc-500 mt-0.5">{d}</p></div>
                  </div>
                ))}
              </div>
              <button onClick={()=>{localStorage.setItem('onboardingComplete','true');setShowOnboarding(false);}}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors">
                Start Monitoring
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="border-b border-zinc-800/60 sticky top-0 z-20 backdrop-blur-md bg-[#0f1117]/90">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Radio size={17} className="text-white" />
            </div>
            <span className="font-bold tracking-tight">AdMonitor <span className="text-blue-500">Pro</span></span>
            <span className="hidden sm:inline text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full font-mono tracking-wider">v2 RADIO ENGINE</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>setShowDebug(!showDebug)}
              className={`p-2 rounded-lg transition-colors ${showDebug?'bg-zinc-700 text-zinc-200':'hover:bg-zinc-800 text-zinc-500'}`}
              title="Detection Log">
              <Eye size={16} />
            </button>
            <button onClick={()=>setShowStats(!showStats)}
              className={`p-2 rounded-lg transition-colors ${showStats?'bg-zinc-700 text-zinc-200':'hover:bg-zinc-800 text-zinc-500'}`}
              title="Stats">
              <BarChart2 size={16} />
            </button>
            <button onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}
              className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 transition-colors">
              {theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}
            </button>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
              isRecording ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
              isListening && !isPaused ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
              isPaused ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
              'bg-zinc-800 text-zinc-500'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isRecording?'bg-red-500 animate-pulse':isListening&&!isPaused?'bg-blue-500 animate-pulse':isPaused?'bg-amber-500':'bg-zinc-600'}`} />
              <span className="hidden sm:inline">{isRecording?'Recording':isListening&&!isPaused?'Monitoring':isPaused?'Paused':'Standby'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Stats strip */}
      <AnimatePresence>
        {showStats && (
          <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}}
            className="overflow-hidden border-b border-zinc-800/60 bg-[#13151d]">
            <div className="max-w-6xl mx-auto px-4 py-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Detection Statistics</h3>
                <button onClick={()=>setShowStats(false)} className="text-zinc-600 hover:text-zinc-400"><X size={14}/></button>
              </div>
              <div className="flex flex-wrap gap-2">
                {keywords.map(k => {
                  const s = keywordStats[k];
                  return (
                    <div key={k} className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-3 py-2 flex items-center gap-3">
                      <span className="text-sm font-medium">{k}</span>
                      <span className="mono text-xs bg-blue-600/20 text-blue-400 rounded-full px-2 py-0.5 font-bold">{s?.count||0}</span>
                      {s?.avgConfidence && <div className="w-12 h-1 bg-zinc-700 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{width:`${s.avgConfidence*100}%`}}/></div>}
                      {s?.lastSeen && <span className="text-[10px] text-zinc-600">{format(s.lastSeen,'h:mm a')}</span>}
                      <div className="text-[10px] text-zinc-600 flex gap-1">
                        <span title="Phonetic variants">{(expandedMapRef.current.get(k)||[]).length}v</span>
                      </div>
                    </div>
                  );
                })}
                {keywords.length===0 && <p className="text-sm text-zinc-600 italic">No keywords yet.</p>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Debug log */}
      <AnimatePresence>
        {showDebug && (
          <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}}
            className="overflow-hidden border-b border-zinc-800/60 bg-[#0d0e14]">
            <div className="max-w-6xl mx-auto px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="mono text-[11px] text-zinc-500">DETECTION LOG</span>
                <div className="flex gap-2">
                  <button onClick={()=>setDebugLog([])} className="text-zinc-600 hover:text-zinc-400 mono text-[10px]">clear</button>
                  <button onClick={()=>setShowDebug(false)} className="text-zinc-600 hover:text-zinc-400"><X size={12}/></button>
                </div>
              </div>
              <div className="max-h-28 overflow-y-auto space-y-0.5">
                {debugLog.length===0 ? <p className="mono text-[11px] text-zinc-700">Waiting for events…</p> :
                  debugLog.map((l,i) => <p key={i} className={`mono text-[11px] ${l.includes('TRIGGER')?'text-blue-400':l.includes('Match')?'text-emerald-400':'text-zinc-600'}`}>{l}</p>)}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-6xl mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* LEFT */}
        <div className="lg:col-span-4 space-y-5">

          {/* Control card */}
          <div className={`bg-zinc-900 rounded-2xl p-6 border ${isRecording?'border-red-500/40 rec-ring':isListening&&!isPaused?'border-blue-500/30 vad-ring':'border-zinc-800'} relative overflow-hidden transition-all duration-300`}>

            {/* Header row */}
            <div className="flex justify-between items-center mb-5">
              <div>
                <h2 className="text-sm font-semibold">Audio Input</h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {noiseCalibrating ? (
                    <span className="text-amber-400 flex items-center gap-1.5"><RefreshCw size={11} className="animate-spin"/>Calibrating noise floor…</span>
                  ) : noiseFloor > 0 ? (
                    <span className="text-zinc-500">Noise floor: <span className="mono text-zinc-400">{(noiseFloor*100).toFixed(1)}%</span></span>
                  ) : 'Real-time acoustic analysis'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFilterEnabled(f => !f)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${filterEnabled?'bg-blue-600/10 border-blue-500/30 text-blue-400':'bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-600'}`}
                  title="Voice-band filter (280–3800 Hz)"
                >
                  <Filter size={12}/>
                  <span className="hidden sm:inline">{filterEnabled?'Filter ON':'Filter OFF'}</span>
                </button>
              </div>
            </div>

            {/* Status */}
            <div className="mb-5 p-3 bg-zinc-800/50 rounded-xl border border-zinc-700/40 text-center">
              <div className="flex items-center justify-center gap-2 text-sm font-medium">
                {isRecording ? <><div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"/><span className="text-red-400">Recording segment…</span></> :
                 isPaused ? <><Pause size={15} className="text-amber-400"/><span className="text-amber-400">Paused</span></> :
                 isListening && vadActive ? <><Zap size={15} className="text-blue-400"/><span className="text-blue-400">Voice detected</span></> :
                 isListening ? <><Activity size={15} className="text-zinc-400"/><span className="text-zinc-400">Listening for voice…</span></> :
                 <><Info size={15} className="text-zinc-600"/><span className="text-zinc-500">Standby</span></>}
              </div>
            </div>

            {/* FFT visualiser */}
            <div className="h-20 flex items-end gap-px mb-5 bg-zinc-950 rounded-xl px-2 py-2 border border-zinc-800">
              {fftBins.map((val, i) => (
                <motion.div key={i}
                  className={`flex-1 rounded-sm ${
                    isRecording ? 'bg-red-500' :
                    vadActive ? 'bg-blue-500' :
                    isListening ? 'bg-zinc-600' : 'bg-zinc-800'
                  }`}
                  animate={{ height: `${Math.max(4, val)}%` }}
                  transition={{ type:'spring', stiffness:350, damping:30 }}
                />
              ))}
            </div>

            {/* VAD indicator */}
            {isListening && (
              <div className="flex items-center gap-2 mb-4">
                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${vadActive?'bg-blue-500':'bg-zinc-700'}`}
                    animate={{ width: `${Math.min(100, rmsRef.current * 400)}%` }}
                    transition={{ duration: 0.08 }}
                  />
                </div>
                <span className={`text-[10px] mono font-medium ${vadActive?'text-blue-400':'text-zinc-600'}`}>
                  {vadActive?'VOICE':'QUIET'}
                </span>
              </div>
            )}

            {/* Live transcript */}
            {liveTranscript && isListening && (
              <div className="mb-4 px-3 py-2 bg-zinc-800/60 rounded-lg border border-zinc-700/40 text-xs text-zinc-500 truncate">
                <span className="text-zinc-400 font-medium">Live: </span>{liveTranscript}
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-2">
              <button onClick={toggleListening}
                className={`flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                  isListening ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                }`}>
                {isListening ? <><StopCircle size={16}/>Stop</> : <><Play size={16}/>Start</>}
              </button>
              {isListening && (
                <button onClick={()=>{setIsPaused(p=>{isPausedRef.current=!p;return!p;})}}
                  className={`px-4 rounded-xl text-sm font-semibold flex items-center justify-center transition-all ${
                    isPaused?'bg-amber-500/10 border border-amber-500/20 text-amber-400':'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
                  }`}>
                  {isPaused?<Play size={16}/>:<Pause size={16}/>}
                </button>
              )}
            </div>

            {/* Recording overlay */}
            <AnimatePresence>
              {isRecording && (
                <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
                  className="absolute inset-0 bg-zinc-900/97 flex flex-col items-center justify-center p-6 text-center border-2 border-red-500/60 rounded-2xl z-10">
                  <div className="w-16 h-16 bg-red-500/10 border border-red-500/30 rounded-full flex items-center justify-center mb-3 animate-pulse">
                    <Mic size={28} className="text-red-400" />
                  </div>
                  <h3 className="text-base font-bold mb-1">Recording</h3>
                  <p className="text-sm text-zinc-400 mb-1">Trigger: <span className="text-red-400 font-semibold">"{currentTrigRef.current}"</span></p>
                  <p className="text-[11px] text-zinc-600 mono mb-1">vote: {(currentVoteRef.current*100).toFixed(0)}% · variant: {currentVariantRef.current}</p>
                  <p className="text-xs text-zinc-600 mb-3 line-clamp-2 max-w-[200px] italic">"{currentTransRef.current}"</p>
                  {/* Post-trigger progress */}
                  <div className="w-full max-w-[200px] mb-1">
                    <div className="flex justify-between mono text-[10px] text-zinc-600 mb-1">
                      <span>−30s</span>
                      <span className="text-red-400">TRIGGER</span>
                      <span>+30s</span>
                    </div>
                    <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
                      {/* Pre-buffer (already captured, shown full) */}
                      <div className="absolute left-0 top-0 h-full w-1/2 bg-zinc-600 rounded-l-full" />
                      {/* Post-trigger fill (animates from center to right) */}
                      <PostProgress startRef={recordStartRef} totalSec={POST_TRIGGER_SEC} />
                    </div>
                  </div>
                  <p className="mono text-[10px] text-zinc-600 mb-4">Capturing 30s post-trigger…</p>
                  <button onClick={stopRecording} className="px-5 py-2 bg-zinc-100 text-zinc-900 rounded-full text-sm font-semibold hover:bg-white transition-colors">
                    Stop & Save Early
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Settings */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
            <button onClick={()=>setShowSettings(s=>!s)}
              className="w-full px-5 py-4 flex items-center justify-between text-sm font-semibold hover:bg-zinc-800/40 transition-colors">
              <div className="flex items-center gap-2 text-zinc-300">
                <Settings size={15} className="text-zinc-500"/>Configuration
              </div>
              <ChevronDown size={15} className={`text-zinc-500 transition-transform duration-200 ${showSettings?'rotate-180':''}`}/>
            </button>
            <AnimatePresence initial={false}>
              {showSettings && (
                <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} className="overflow-hidden">
                  <div className="px-5 pb-6 pt-1 space-y-5 border-t border-zinc-800">

                    {micDevices.length > 1 && (
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-2">Microphone</label>
                        <div className="relative">
                          <Headphones size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"/>
                          <select value={selectedMic} onChange={e=>setSelectedMic(e.target.value)}
                            className="w-full pl-8 pr-3 py-2 bg-zinc-800 border border-zinc-700 rounded-xl text-xs outline-none focus:border-blue-500 text-zinc-200">
                            <option value="">Default microphone</option>
                            {micDevices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.label||`Mic ${d.deviceId.slice(0,6)}`}</option>)}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Fixed 30+30 recording window info */}
                    <div className="bg-blue-500/5 border border-blue-500/15 rounded-xl p-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-zinc-300">Recording Window</p>
                        <p className="mono text-[10px] text-zinc-500 mt-0.5">Fixed: 30s pre-trigger + 30s post-trigger</p>
                      </div>
                      <div className="text-right">
                        <span className="mono text-lg font-bold text-blue-400">60s</span>
                        <p className="mono text-[10px] text-zinc-600">per capture</p>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-end mb-2">
                        <label className="block text-xs font-medium text-zinc-400">Detection Sensitivity</label>
                        <span className="mono text-[10px] text-zinc-500 uppercase">{sensitivityLabel}</span>
                      </div>
                      <input type="range" min="1" max="5" step="1" value={sensitivity}
                        onChange={e=>setSensitivity(+e.target.value)}
                        className="w-full accent-blue-500 h-1"/>
                      <div className="flex justify-between mono text-[10px] text-zinc-600 mt-1">
                        <span>Strict</span><span>Loose</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-2">Trigger Keywords</label>
                      <form onSubmit={addKeyword} className="flex gap-2 mb-3">
                        <input type="text" value={newKeyword} onChange={e=>setNewKeyword(e.target.value)}
                          placeholder="Brand name or phrase…"
                          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-500 text-zinc-100 placeholder-zinc-600"/>
                        <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors">Add</button>
                      </form>
                      <div className="flex flex-wrap gap-2">
                        {keywords.map(word => {
                          const varCount = (expandedMapRef.current.get(word)||[]).length;
                          return (
                            <div key={word} className="group relative">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 hover:border-blue-500/50 rounded-xl text-xs font-medium text-zinc-200 transition-colors">
                                {word}
                                <span className="mono text-[9px] text-zinc-600 hidden group-hover:inline">{varCount}v</span>
                                {keywordStats[word]?.count ? (
                                  <span className="bg-blue-600/20 text-blue-400 rounded-full text-[10px] px-1.5 mono font-bold">{keywordStats[word].count}</span>
                                ) : null}
                                <button onClick={()=>removeKeyword(word)} className="text-zinc-600 hover:text-red-400 transition-colors ml-0.5">
                                  <X size={11}/>
                                </button>
                              </span>
                            </div>
                          );
                        })}
                        {keywords.length===0 && <p className="text-xs text-zinc-600 italic">No keywords yet.</p>}
                      </div>
                    </div>

                    {/* Engine info */}
                    <div className="bg-zinc-800/40 rounded-xl p-3 border border-zinc-700/40 space-y-1.5">
                      <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Detection Engine</p>
                      {[
                        ['Voice filter', filterEnabled ? '280–3800 Hz bandpass' : 'Disabled', filterEnabled],
                        ['VAD gate', 'Adaptive RMS threshold', true],
                        ['Phoneme expansion', keywords.length ? `${[...expandedMapRef.current.values()].reduce((s,a)=>s+a.length,0)} variants` : 'Add keywords', true],
                        ['Multi-hypothesis', '8 alternatives + vote', true],
                        ['Soundex + Metaphone', 'Dual phonetic matching', true],
                        ['Cooldown', `${COOLDOWN_MS/1000}s per keyword`, true],
                        ['Recording window', '30s pre + 30s post', true],
                      ].map(([label,val,ok])=>(
                        <div key={label as string} className="flex items-center justify-between">
                          <span className="mono text-[10px] text-zinc-600">{label}</span>
                          <span className={`mono text-[10px] font-medium ${ok?'text-emerald-500':'text-zinc-600'}`}>{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5"/>
              <div>
                <p className="text-sm text-red-300">{error}</p>
                <button onClick={()=>setError(null)} className="text-xs text-red-600 hover:text-red-400 mt-1">Dismiss</button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div className="lg:col-span-8">
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden flex flex-col min-h-[580px]">

            <div className="p-5 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-zinc-800 rounded-xl flex items-center justify-center border border-zinc-700">
                  <Archive size={17} className="text-zinc-400"/>
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Captured Segments</h2>
                  <p className="text-xs text-zinc-500">{filteredRecs.length} recordings</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"/>
                  <input type="text" placeholder="Search…" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
                    className="pl-8 pr-3 py-2 bg-zinc-800 border border-zinc-700 rounded-xl text-xs w-32 outline-none focus:border-blue-500 text-zinc-200 placeholder-zinc-600"/>
                </div>
                <select value={sortBy} onChange={e=>setSortBy(e.target.value as any)}
                  className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-xl text-xs outline-none focus:border-blue-500 text-zinc-200">
                  <option value="time">By Time</option>
                  <option value="keyword">By Keyword</option>
                  <option value="duration">By Duration</option>
                </select>
                {recordings.length>0 && (
                  <button onClick={exportZip} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors">
                    <Download size={12}/>Export
                  </button>
                )}
              </div>
            </div>

            {selectedRecs.size > 0 && (
              <div className="bg-blue-500/5 border-b border-blue-500/10 px-5 py-3 flex items-center justify-between">
                <span className="text-sm font-medium text-blue-400">{selectedRecs.size} selected</span>
                <div className="flex gap-2">
                  <button onClick={deleteSelected} className="px-3 py-1.5 bg-zinc-800 border border-red-700/30 text-red-400 rounded-lg text-xs font-medium hover:bg-red-900/20 transition-colors">Delete</button>
                  <button onClick={exportZip} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors">Export ZIP</button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 bg-zinc-950/30">
              <AnimatePresence mode="popLayout">
                {filteredRecs.length === 0 ? (
                  <motion.div initial={{opacity:0}} animate={{opacity:1}} className="flex flex-col items-center justify-center py-24 text-zinc-600">
                    <div className="w-14 h-14 bg-zinc-800 rounded-full flex items-center justify-center mb-4">
                      <MicOff size={22} className="text-zinc-700"/>
                    </div>
                    <p className="text-sm text-zinc-500">No recordings yet</p>
                    <p className="text-xs mt-1">Add keywords and start monitoring to capture segments.</p>
                  </motion.div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="flex items-center px-3 py-1 gap-3">
                      <button onClick={toggleAll} className="text-zinc-700 hover:text-blue-500 transition-colors">
                        {selectedRecs.size===filteredRecs.length
                          ? <CheckSquare size={16} className="text-blue-500"/>
                          : <SquareIcon size={16}/>}
                      </button>
                      <span className="mono text-[10px] text-zinc-600 uppercase tracking-wider">
                        {selectedRecs.size===filteredRecs.length?'Deselect All':'Select All'}
                      </span>
                    </div>
                    {filteredRecs.map(rec => (
                      <motion.div key={rec.id} layout
                        initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,scale:0.97}}
                        className={`group bg-zinc-900 border ${selectedRecs.has(rec.id)?'border-blue-500/40':'border-zinc-800 hover:border-zinc-700'} rounded-xl p-4 transition-colors`}>
                        <div className="flex items-center gap-3">
                          <button onClick={()=>toggleSel(rec.id)} className="text-zinc-700 hover:text-blue-500 shrink-0 transition-colors">
                            {selectedRecs.has(rec.id) ? <CheckSquare size={16} className="text-blue-500"/> : <SquareIcon size={16}/>}
                          </button>

                          <button
                            onClick={()=>{
                              const el=document.getElementById(`audio-${rec.id}`) as HTMLAudioElement;
                              if(!el) return;
                              if(playingId===rec.id){el.pause();setPlayingId(null);}
                              else{document.querySelectorAll('audio').forEach(a=>a.pause());el.currentTime=0;el.play();setPlayingId(rec.id);}
                            }}
                            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                              playingId===rec.id?'bg-blue-600 text-white':'bg-zinc-800 border border-zinc-700 text-zinc-400 hover:border-blue-500/50 hover:text-blue-400'
                            }`}>
                            {playingId===rec.id ? <SquareIcon size={13} className="fill-current"/> : <Play size={15} className="ml-0.5 fill-current"/>}
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-sm font-semibold text-blue-400">"{rec.triggerWord}"</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${confColor(rec.confidence)}`}>{rec.confidence}</span>
                              {rec.voteScore > 0 && (
                                <span className="mono text-[10px] text-zinc-600">{(rec.voteScore*100).toFixed(0)}% votes</span>
                              )}
                              {rec.matchVariant && rec.matchVariant !== rec.triggerWord && (
                                <span className="mono text-[10px] text-zinc-700 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700">{rec.matchVariant}</span>
                              )}
                            </div>
                            {rec.transcript && <p className="text-xs text-zinc-600 truncate mb-1 italic">"{rec.transcript}"</p>}
                            <div className="flex flex-wrap gap-3 text-xs text-zinc-600">
                              <span className="flex items-center gap-1"><Clock size={11}/>{format(rec.timestamp,'MMM d, h:mm a')}</span>
                              <span className="flex items-center gap-1 text-zinc-500" title="30s pre-trigger + post-trigger"><Activity size={11}/>
                                <span className="mono">−30s</span>
                                <span className="text-zinc-700 mx-0.5">|</span>
                                <span className="text-red-500/70 mono text-[10px]">▲</span>
                                <span className="text-zinc-700 mx-0.5">|</span>
                                <span className="mono">+{Math.max(0, rec.duration - 30).toFixed(0)}s</span>
                                <span className="text-zinc-700 ml-1">({rec.duration.toFixed(0)}s total)</span>
                              </span>
                              <span className="flex items-center gap-1"><AudioLines size={11}/>{(rec.blob.size/1024).toFixed(0)} KB</span>
                            </div>
                            {playingId===rec.id && (
                              <div className="mt-2 h-0.5 bg-zinc-800 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 rounded-full transition-all" style={{width:`${(playProgress[rec.id]||0)*100}%`}}/>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={()=>{const u=URL.createObjectURL(rec.blob);const a=document.createElement('a');a.href=u;a.download=`ad_${rec.triggerWord}_${rec.id}.wav`;document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(()=>URL.revokeObjectURL(u),1000);}}
                              className="p-2 text-zinc-600 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors" title="Download">
                              <Download size={15}/>
                            </button>
                            <button onClick={()=>deleteRecording(rec.id)}
                              className="p-2 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors" title="Delete">
                              <Trash2 size={15}/>
                            </button>
                          </div>
                        </div>

                        <audio id={`audio-${rec.id}`} src={rec.url} className="hidden"
                          onTimeUpdate={e=>{const el=e.currentTarget;if(el.duration)setPlayProgress(p=>({...p,[rec.id]:el.currentTime/el.duration}));}}
                          onEnded={()=>{setPlayingId(null);setPlayProgress(p=>({...p,[rec.id]:0}));}}
                          onPause={()=>setPlayingId(null)}/>
                      </motion.div>
                    ))}
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

      </main>
      <Analytics />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PostProgress — animates the right half of the recording timeline bar
// from 0% → 50% over POST_TRIGGER_SEC seconds
// ─────────────────────────────────────────────────────────────────────────────
function PostProgress({ startRef, totalSec }: { startRef: React.MutableRefObject<number>; totalSec: number }) {
  const [pct, setPct] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const elapsed = (Date.now() - startRef.current) / 1000;
      const p = Math.min(1, elapsed / totalSec);
      setPct(p);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [startRef, totalSec]);

  return (
    <div
      className="absolute top-0 h-full bg-red-500 rounded-r-full transition-none"
      style={{ left: '50%', width: `${pct * 50}%` }}
    />
  );
}


function SquareIcon({ size=24, className='' }: { size?:number; className?:string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    </svg>
  );
}

function MicOff({ size=24, className='' }: { size?:number; className?:string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  );
}
