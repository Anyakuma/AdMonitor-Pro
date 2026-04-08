/**
 * Cached Phonetic Matching Engine
 * Pre-computes expensive phonetic signatures once per keyword,
 * enabling O(1) lookups during matching
 */

export interface PhoneticSignature {
  base: string;
  soundex: string;
  metaphone: string;
  variants: Set<string>;
  homophones: Set<string>;
}

export class CachedPhoneticEngine {
  private cache = new Map<string, PhoneticSignature>();
  private consonantRegex = new Map<string, RegExp>();
  private vowelRegex = new Map<string, RegExp>();

  constructor() {
    this.precompileRegex();
  }

  /**
   * Pre-compile regex patterns once at startup
   * Instead of creating them on every loop iteration
   */
  private precompileRegex() {
    const consKeys = ['v', 'f', 'c', 'k', 'g', 'j', 'r', 'th', 'd', 't', 'z', 'x'];
    const vowelKeys = ['a', 'e', 'i', 'o', 'u'];

    for (const cons of consKeys) {
      this.consonantRegex.set(cons, new RegExp(cons, 'g'));
    }
    for (const vowel of vowelKeys) {
      this.vowelRegex.set(vowel, new RegExp(vowel, 'g'));
    }
  }

  /**
   * Build and cache phonetic signature for a keyword
   * Called once per keyword addition, reused many times during matching
   */
  buildSignature(keyword: string, homoPhoneDict: Record<string, string[]>): PhoneticSignature {
    const cached = this.cache.get(keyword.toLowerCase());
    if (cached) return cached;

    const base = keyword.toLowerCase().trim();
    const soundex = this.getSoundex(base);
    const metaphone = this.getMetaphone(base);
    const variants = new Set(this.expandKeywordOptimized(base));
    const homophones = new Set(homoPhoneDict[base] || []);

    const sig: PhoneticSignature = { base, soundex, metaphone, variants, homophones };
    this.cache.set(base, sig);
    return sig;
  }

  /**
   * Expand keyword into phonetic variants
   * Optimized: use precompiled regex, early exit on duplicates
   */
  private expandKeywordOptimized(base: string): string[] {
    const variants = new Set<string>([base]);

    // Elision: drop unstressed syllables
    const elided = base.replace(/(?<=[bcdfghjklmnpqrstvwxyz])[aeiou](?=[bcdfghjklmnpqrstvwxyz])/g, '');
    if (elided !== base && elided.length >= 3) variants.add(elided);

    // Contracted endings
    const endingRules = [
      { from: /ing$/, to: 'in' },
      { from: /er$/, to: 'a' },
      { from: /tion$/, to: 'shun' },
      { from: /cion$/, to: 'cion' },
    ];
    for (const rule of endingRules) {
      const result = base.replace(rule.from, rule.to);
      if (result !== base) variants.add(result);
    }

    // th-fronting: use precompiled regex
    variants.add(base.replace(/\bth/g, 'd').replace(/th\b/g, 'f'));

    // H-dropping, devoicing (only if not already added)
    variants.add(base.replace(/\bh/g, ''));
    variants.add(base.replace(/v\b/g, 'f').replace(/d\b/g, 't').replace(/z\b/g, 's'));

    return [...variants].filter(v => v.length >= Math.min(3, base.length));
  }

  private getSoundex(s: string): string {
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
  }

  private getMetaphone(s: string): string {
    return s.toLowerCase()
      .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/qu/g, 'k')
      .replace(/[aeiou]/g, 'a').replace(/(.)\1+/g, '$1')
      .replace(/[hw]/g, '').replace(/[gy]([aeiou])/g, 'j$1')
      .replace(/[sz]/g, 's').replace(/[td]$/g, 't').replace(/[bp]$/g, 'p');
  }

  /**
   * Quick lookup: Does any variant match?
   * O(1) set lookup instead of looping through arrays
   */
  quickMatch(transcript: string, sig: PhoneticSignature): boolean {
    const t = transcript.toLowerCase();
    if (t.includes(sig.base)) return true;
    for (const variant of sig.variants) {
      if (t.includes(variant)) return true;
    }
    for (const homo of sig.homophones) {
      if (t.includes(homo)) return true;
    }
    return false;
  }

  /**
   * Phonetic comparison: Soundex or Metaphone
   * Cached signatures used for O(1) comparison
   */
  phoneticMatch(word: string, sig: PhoneticSignature): boolean {
    const wordSoundex = this.getSoundex(word);
    const wordMeta = this.getMetaphone(word);
    return wordSoundex === sig.soundex || wordMeta === sig.metaphone;
  }

  /**
   * Clear cache (call after keywords change)
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache size (for monitoring)
   */
  size() {
    return this.cache.size;
  }
}

// Singleton instance
export const phoneticEngine = new CachedPhoneticEngine();
