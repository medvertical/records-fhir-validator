/**
 * Profile Cache
 * 
 * In-memory cache for loaded StructureDefinitions
 * Reduces repeated file I/O and parsing
 */

import type { StructureDefinition } from '../core/structure-definition-loader.js';
import { logger } from '../logger.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';

// ============================================================================
// Types
// ============================================================================

interface CacheEntry {
  profile: StructureDefinition;
  timestamp: number;
  lastAccessedAt: number;
  hits: number;
}

// ============================================================================
// Profile Cache
// ============================================================================

export class ProfileCache {
  private cache: Map<string, CacheEntry> = new Map();
  private enabled: boolean;
  private ttl: number = 3600000; // 1 hour TTL
  private maxSize: number;

  constructor(enabled: boolean = true, maxSize: number = 192) {
    this.enabled = enabled;
    this.maxSize = normalizePositiveInteger(maxSize, 192);
  }

  /**
   * Get a profile from cache
   */
  get(url: string): StructureDefinition | null {
    if (!this.enabled) {
      return null;
    }

    const entry = this.cache.get(url);

    if (!entry) {
      return null;
    }

    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(url);
      return null;
    }

    // Increment hit counter
    entry.hits++;
    entry.lastAccessedAt = Date.now();
    this.cache.delete(url);
    this.cache.set(url, entry);

    return entry.profile;
  }

  /**
   * Store a profile in cache
   */
  set(url: string, profile: StructureDefinition): void {
    if (!this.enabled) {
      return;
    }

    // Replacing an existing profile must not evict an unrelated entry.
    if (!this.cache.has(url) && this.cache.size >= this.maxSize) {
      // Remove least recently used entry
      this.evictLRU();
    }

    const now = Date.now();
    this.cache.delete(url);
    this.cache.set(url, {
      profile,
      timestamp: now,
      lastAccessedAt: now,
      hits: 0
    });
  }

  /**
   * Check if profile is in cache
   */
  has(url: string): boolean {
    if (!this.enabled) {
      return false;
    }

    const entry = this.cache.get(url);

    if (!entry) {
      return false;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(url);
      return false;
    }

    return true;
  }

  /**
   * Remove a profile from cache
   */
  delete(url: string): void {
    this.cache.delete(url);
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    ttl: number;
    entries: Array<{ url: string; hits: number; age: number }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([url, entry]) => ({
      url,
      hits: entry.hits,
      age: now - entry.timestamp
    }));

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
      entries
    };
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestUrl: string | null = null;
    let oldestAccess = Infinity;

    // Find the least recently accessed entry.
    for (const [url, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestAccess) {
        oldestUrl = url;
        oldestAccess = entry.lastAccessedAt;
      }
    }

    if (oldestUrl) {
      this.cache.delete(oldestUrl);
      logger.debug('[ProfileCache] Evicted LRU entry', profileCanonicalMetadata(oldestUrl));
    }
  }

  /**
   * Enable/disable cache
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  /**
   * Set TTL (time to live) in milliseconds
   */
  setTTL(ttl: number): void {
    this.ttl = normalizePositiveInteger(ttl, this.ttl);
  }

  /**
   * Set max cache size
   */
  setMaxSize(maxSize: number): void {
    this.maxSize = normalizePositiveInteger(maxSize, this.maxSize);

    // Evict entries if cache is now too large
    while (this.cache.size > this.maxSize) {
      this.evictLRU();
    }
  }
}

function normalizePositiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0
    ? Math.max(1, Math.trunc(value))
    : fallback;
}
