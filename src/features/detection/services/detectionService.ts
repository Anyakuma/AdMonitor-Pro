/**
 * Detection Service — Core keyword matching, voting, and phonetic expansion
 * Extracted from App.tsx to improve reusability and testability
 */

import type { PhoneticSignature } from '../../../lib/performance/phoneticCache';

export type Confidence = 'Strong' | 'Good' | 'Weak';
export type SoundexCode = string;
export type MetaphoneCode = string;

// ─────────────────────────────────────────────────────────────────────────────
// Phonetic Algorithms — Soundex, Metaphone, Levenshtein
// ─────────────────────────────────────────────────────────────────────────────

export const SOUNDEX_MAP: Record<string, string> = {
  b: '1', f: '1', p: '1', v: '1',
  c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
  d: '3', t: '3',
  l: '4',
  m: '5', n: '5',
  r: '6',
};

export function getSoundex(s: string): SoundexCode {
  if (!s) return '';
  const MAP = SOUNDEX_MAP;
  let out = s[0].toUpperCase();
  let prev = MAP[s[0].toLowerCase()] || '0';
  
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const c = s[i].toLowerCase();
    const code = MAP[c];
    if (code && code !== prev) out += code;
    prev = code || ('aeiouyhw'.includes(c) ? '0' : prev);
  }
  
  return (out + '000').slice(0, 4);
}

export function getMetaphone(s: string): MetaphoneCode {
  return s.toLowerCase()
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/qu/g, 'k')
    .replace(/[aeiou]/g, 'a')
    .replace(/(.)\1+/g, '$1')
    .replace(/[hw]/g, '')
    .replace(/[gy]([aeiou])/g, 'j$1')
    .replace(/[sz]/g, 's')
    .replace(/[td]$/g, 't')
    .replace(/[bp]$/g, 'p');
}

/**
 * Levenshtein distance — Edit distance between two strings
 */
export function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  
  let prev = new Int32Array(b.length + 1).map((_, i) => i);
  let curr = new Int32Array(b.length + 1);
  
  for (let i = 0; i < a.length; i++) {
    curr[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const c = a[i] === b[j] ? 0 : 1;
      curr[j + 1] = Math.min(
        curr[j] + 1,      // insertion
        prev[j + 1] + 1,  // deletion
        prev[j] + c       // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  
  return prev[b.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching Algorithm — Check if transcript contains keyword
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchResult {
  matched: boolean;
  confidence: Confidence;
  variant: string;
  matchType: string; // 'exact' | 'variant' | 'fuzzy' | 'phonetic'
}

export interface MatchingConfig {
  sensitivity: 1 | 2 | 3 | 4 | 5; // 1=strict, 5=loose
  minWordLength?: number;
}

/**
 * Match a transcript against a single keyword using multiple strategies
 */
export function matchTranscriptToKeyword(
  transcript: string,
  keyword: string,
  variants: string[],
  config: MatchingConfig = { sensitivity: 3 }
): MatchResult {
  const NO: MatchResult = { matched: false, confidence: 'Weak', variant: '', matchType: 'none' };
  const t = transcript.toLowerCase().replace(/['']/g, '');
  const k = keyword.toLowerCase();

  // ─ Exact substring match ─────────────────────────────────────────────────
  if (t.includes(k)) {
    return { matched: true, confidence: 'Strong', variant: k, matchType: 'exact' };
  }

  // ─ Variant (phoneme expansion) match ─────────────────────────────────────
  for (const v of variants) {
    if (t.includes(v)) {
      return {
        matched: true,
        confidence: v === k ? 'Strong' : 'Good',
        variant: v,
        matchType: 'variant',
      };
    }
  }

  // Low sensitivity: stop here
  if (config.sensitivity === 1) return NO;

  // ─ Mashed (no-space) match ──────────────────────────────────────────────
  const mt = t.replace(/[^a-z0-9]/g, '');
  const mk = k.replace(/[^a-z0-9]/g, '');
  if (mt.includes(mk)) {
    return { matched: true, confidence: 'Strong', variant: k, matchType: 'exact' };
  }

  // ─ Sliding window with edit distance ────────────────────────────────────
  if (mk.length >= 4) {
    let allowed = mk.length <= 5 ? 1 : mk.length <= 8 ? 2 : 3;
    if (config.sensitivity <= 2) allowed = Math.max(0, allowed - 1);
    if (config.sensitivity >= 4) allowed++;
    if (config.sensitivity === 5) allowed++;

    for (let i = 0; i <= mt.length - mk.length + allowed; i++) {
      for (let d = -allowed; d <= allowed; d++) {
        const len = mk.length + d;
        if (len < 4 || i + len > mt.length) continue;
        const dist = levenshtein(mt.slice(i, i + len), mk);
        if (dist <= allowed) {
          return {
            matched: true,
            confidence: dist <= 1 ? 'Good' : 'Weak',
            variant: `~${mk}`,
            matchType: 'fuzzy',
          };
        }
      }
    }
  }

  // ─ Per-word phonetic matching (Soundex + Metaphone) ─────────────────────
  const tWords = t.split(/[\s,.\-!?;:]+/).filter(Boolean);
  const kWords = k.split(/\s+/).filter(Boolean);
  
  let maxDist = k.length <= 3 ? 0 : k.length <= 5 ? 1 : 2;
  if (config.sensitivity <= 2) maxDist = Math.max(0, maxDist - 1);
  if (config.sensitivity >= 4) maxDist++;
  if (config.sensitivity === 5) maxDist++;

  if (kWords.length === 1) {
    const kSdx = getSoundex(mk);
    const kMeta = getMetaphone(mk);
    
    for (const tw of tWords) {
      const tSdx = getSoundex(tw);
      const tMeta = getMetaphone(tw);
      
      if (kSdx && tSdx === kSdx && kSdx !== '0000') {
        return {
          matched: true,
          confidence: 'Good',
          variant: tw,
          matchType: 'phonetic',
        };
      }
      
      if (kMeta && tMeta === kMeta) {
        return {
          matched: true,
          confidence: 'Good',
          variant: tw,
          matchType: 'phonetic',
        };
      }
      
      const tl = tw.length;
      if ((kMeta.length >= 2) && levenshtein(tMeta, kMeta) <= maxDist) {
        return {
          matched: true,
          confidence: 'Weak',
          variant: tw,
          matchType: 'phonetic',
        };
      }
    }
  }

  return NO;
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Hypothesis Voting — Score all speech recognition alternatives
// ─────────────────────────────────────────────────────────────────────────────

export interface VoteResult {
  matched: boolean;
  keyword?: string;
  confidence?: Confidence;
  voteScore?: number; // 0–1: fraction of hypotheses that matched
  transcript?: string;
  variant?: string;
}

export interface Hypothesis {
  transcript: string;
  confidence?: number;
}

/**
 * Vote on multiple hypotheses to determine best keyword match
 */
export function voteOnHypotheses(
  hypotheses: Hypothesis[],
  keywordSignatures: Map<string, PhoneticSignature>,
  config: MatchingConfig = { sensitivity: 3 }
): VoteResult {
  if (!hypotheses.length || !keywordSignatures.size) {
    return { matched: false };
  }

  // Build expanded variants and homophones maps for faster lookup
  const expandedMap = new Map<string, string[]>();
  const homoMap = new Map<string, string[]>();
  
  for (const [kw, sig] of keywordSignatures.entries()) {
    expandedMap.set(kw, Array.from(sig.variants));
    homoMap.set(kw, Array.from(sig.homophones));
  }

  const votes = new Map<string, {
    confidences: Confidence[];
    weights: number[];
    transcripts: string[];
    variants: string[];
  }>();

  // Check each hypothesis against each keyword
  for (let hypIdx = 0; hypIdx < hypotheses.length; hypIdx++) {
    const hyp = hypotheses[hypIdx];
    const hypWeight = hyp.confidence || (1 - hypIdx * 0.1); // Earlier hypotheses weighted higher

    for (const keyword of keywordSignatures.keys()) {
      const variants = expandedMap.get(keyword) || [];
      const homos = homoMap.get(keyword) || [];
      
      // Check keyword + variants
      const result = matchTranscriptToKeyword(hyp.transcript, keyword, variants, config);
      
      if (result.matched) {
        const existing = votes.get(keyword) || {
          confidences: [],
          weights: [],
          transcripts: [],
          variants: [],
        };
        
        existing.confidences.push(result.confidence);
        existing.weights.push(hypWeight);
        existing.transcripts.push(hyp.transcript);
        existing.variants.push(result.variant);
        
        votes.set(keyword, existing);
      }
      
      // Check homophones
      for (const homo of homos) {
        const homoResult = matchTranscriptToKeyword(hyp.transcript, homo, [], config);
        if (homoResult.matched) {
          const existing = votes.get(keyword) || {
            confidences: [],
            weights: [],
            transcripts: [],
            variants: [],
          };
          
          existing.confidences.push('Good');
          existing.weights.push(hypWeight * 0.8); // Slight penalty for homophone
          existing.transcripts.push(hyp.transcript);
          existing.variants.push(homo);
          
          votes.set(keyword, existing);
        }
      }
    }
  }

  // Find best match
  if (votes.size === 0) {
    return { matched: false };
  }

  let bestKeyword = '';
  let bestScore = 0;
  let bestConfidence: Confidence = 'Weak';
  let bestTranscript = '';
  let bestVariant = '';

  const totalWeight = hypotheses.reduce((sum, h) => sum + (h.confidence || 0.5), 0);

  for (const [keyword, data] of votes.entries()) {
    const matchWeight = data.weights.reduce((a, b) => a + b, 0);
    const voteScore = matchWeight / Math.max(totalWeight, 1);

    // Determine final confidence
    const strongCount = data.confidences.filter(c => c === 'Strong').length;
    const goodCount = data.confidences.filter(c => c === 'Good').length;
    
    let finalConfidence: Confidence = 'Weak';
    if (strongCount >= 4 || voteScore >= 0.85) {
      finalConfidence = 'Strong';
    } else if (strongCount >= 2 || goodCount >= 2 || voteScore >= 0.65) {
      finalConfidence = 'Good';
    }

    // Higher vote score wins
    if (voteScore > bestScore) {
      bestScore = voteScore;
      bestKeyword = keyword;
      bestConfidence = finalConfidence;
      bestTranscript = data.transcripts[0];
      bestVariant = data.variants[0];
    }
  }

  return {
    matched: bestScore > 0,
    keyword: bestKeyword,
    confidence: bestConfidence,
    voteScore: bestScore,
    transcript: bestTranscript,
    variant: bestVariant,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Syllable Guard — Prevent false positives on single phonemes
// ─────────────────────────────────────────────────────────────────────────────

export function countSyllables(word: string): number {
  // Approximate syllable count: vowel groups
  const cleanWord = word.toLowerCase().replace(/[^a-z]/g, '');
  return (cleanWord.match(/[aeiou]+/g) || []).length;
}

export function passedSyllableGuard(keyword: string, matchedWord: string): boolean {
  // Require minimum 2 syllables unless keyword is explicitly short
  if (keyword.length >= 4) {
    const kSyl = countSyllables(keyword);
    const mSyl = countSyllables(matchedWord);
    return mSyl >= 2 || (kSyl <= 2 && mSyl >= 1);
  }
  return true; // No guard for very short keywords
}
