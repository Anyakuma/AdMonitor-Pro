/**
 * useKeywordDetection — Custom hook for keyword detection and cooldown management
 * Handles matching, voting, and per-keyword cooldown timers
 */

import { useCallback, useRef, useState } from 'react';
import * as detectionService from '../services/detectionService';
import type { PhoneticSignature } from '../utils/phoneticCache';

export interface DetectionResult {
  matched: boolean;
  keyword?: string;
  confidence?: 'Strong' | 'Good' | 'Weak';
  voteScore?: number;
  transcript?: string;
  variant?: string;
}

export interface UseKeywordDetectionOptions {
  cooldownMs?: number;
  minVoteScore?: number;
  sensitivityLevel?: 1 | 2 | 3 | 4 | 5;
}

const DEFAULT_COOLDOWN = 10000; // 10 seconds
const DEFAULT_MIN_VOTE_SCORE = 0.5; // 50%
const DEFAULT_SENSITIVITY = 3; // Balanced

export function useKeywordDetection(options: UseKeywordDetectionOptions = {}) {
  const cooldownMs = options.cooldownMs || DEFAULT_COOLDOWN;
  const minVoteScore = options.minVoteScore || DEFAULT_MIN_VOTE_SCORE;
  const sensitivityLevel = options.sensitivityLevel || DEFAULT_SENSITIVITY;

  // Per-keyword cooldown tracking
  const cooldownRef = useRef<Map<string, number>>(new Map());
  const [lastDetectedKeyword, setLastDetectedKeyword] = useState<string | null>(null);
  const [lastDetectionTime, setLastDetectionTime] = useState<number>(0);

  /**
   * Check if keyword is in cooldown
   */
  const isKeywordInCooldown = useCallback((keyword: string): boolean => {
    const lastFire = cooldownRef.current.get(keyword) || 0;
    return Date.now() - lastFire < cooldownMs;
  }, [cooldownMs]);

  /**
   * Mark keyword as triggered (starts cooldown)
   */
  const markKeywordTriggered = useCallback((keyword: string) => {
    cooldownRef.current.set(keyword, Date.now());
  }, []);

  /**
   * Detect keyword from hypotheses (speech recognition results)
   */
  const detectFromHypotheses = useCallback(
    (
      hypotheses: detectionService.Hypothesis[],
      keywordSignatures: Map<string, PhoneticSignature>
    ): DetectionResult => {
      const result = detectionService.voteOnHypotheses(hypotheses, keywordSignatures, {
        sensitivity: sensitivityLevel,
      });

      // Apply vote score threshold
      if (result.matched && (result.voteScore || 0) < minVoteScore) {
        return { matched: false };
      }

      // Check cooldown
      if (result.matched && result.keyword && isKeywordInCooldown(result.keyword)) {
        return { matched: false };
      }

      if (result.matched && result.keyword) {
        markKeywordTriggered(result.keyword);
        setLastDetectedKeyword(result.keyword);
        setLastDetectionTime(Date.now());
      }

      return result as DetectionResult;
    },
    [minVoteScore, sensitivityLevel, isKeywordInCooldown, markKeywordTriggered]
  );

  /**
   * Detect from a single transcript string
   */
  const detectFromTranscript = useCallback(
    (
      transcript: string,
      keyword: string,
      variants: string[],
      sensitivity?: 1 | 2 | 3 | 4 | 5
    ): Omit<DetectionResult, 'voteScore'> => {
      const result = detectionService.matchTranscriptToKeyword(
        transcript,
        keyword,
        variants,
        { sensitivity: sensitivity || sensitivityLevel }
      );

      if (result.matched && isKeywordInCooldown(keyword)) {
        return { matched: false };
      }

      if (result.matched) {
        markKeywordTriggered(keyword);
        setLastDetectedKeyword(keyword);
        setLastDetectionTime(Date.now());
      }

      return {
        matched: result.matched,
        keyword,
        confidence: result.confidence,
        transcript,
        variant: result.variant,
      };
    },
    [sensitivityLevel, isKeywordInCooldown, markKeywordTriggered]
  );

  /**
   * Get remaining cooldown time for a keyword
   */
  const getCooldownRemaining = useCallback((keyword: string): number => {
    const lastFire = cooldownRef.current.get(keyword) || 0;
    const elapsed = Date.now() - lastFire;
    return Math.max(0, cooldownMs - elapsed);
  }, [cooldownMs]);

  /**
   * Force refresh cooldown (e.g., when keywords change)
   */
  const resetCooldowns = useCallback(() => {
    cooldownRef.current.clear();
  }, []);

  /**
   * Get all keywords currently in cooldown
   */
  const getActiveKeywordsInCooldown = useCallback((): string[] => {
    const now = Date.now();
    const active: string[] = [];

    for (const [keyword, lastFire] of cooldownRef.current.entries()) {
      if (now - lastFire < cooldownMs) {
        active.push(keyword);
      }
    }

    return active;
  }, [cooldownMs]);

  return {
    // State
    lastDetectedKeyword,
    lastDetectionTime,

    // Methods
    detectFromHypotheses,
    detectFromTranscript,
    isKeywordInCooldown,
    markKeywordTriggered,
    getCooldownRemaining,
    resetCooldowns,
    getActiveKeywordsInCooldown,
  };
}
