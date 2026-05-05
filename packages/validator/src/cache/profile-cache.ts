/**
 * Profile Cache
 * 
 * In-memory cache for loaded StructureDefinitions
 * Reduces repeated file I/O and parsing
 */

import type { StructureDefinition } from '../core/structure-definition-loader';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

interface CacheEntry {
  profile: StructureDefinition;
  timestamp: number;
  hits: number;
}

// ============================================================================
// Profile Cache
// ============================================================================

export class ProfileCache {
  private cache: Map<string, CacheEntry> = new Map();
  private enabled: boolean;
  private ttl: number = 3600000; // 1 hour TTL
  private maxSize: number = 500; // Max 500 profiles in cache (increased to prevent evictions during batch validation)

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
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

    return entry.profile;
  }

  /**
   * Store a profile in cache
   */
  set(url: string, profile: StructureDefinition): void {
    if (!this.enabled) {
      return;
    }

    // Check if cache is full
    if (this.cache.size >= this.maxSize) {
      // Remove least recently used entry
      this.evictLRU();
    }

    this.cache.set(url, {
      profile,
      timestamp: Date.now(),
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
    let oldestTime = Infinity;
    let lowestHits = Infinity;

    // Find entry with oldest timestamp and lowest hits
    for (const [url, entry] of this.cache.entries()) {
      if (entry.hits < lowestHits ||
        (entry.hits === lowestHits && entry.timestamp < oldestTime)) {
        oldestUrl = url;
        oldestTime = entry.timestamp;
        lowestHits = entry.hits;
      }
    }

    if (oldestUrl) {
      this.cache.delete(oldestUrl);
      logger.info(`[ProfileCache] Evicted LRU entry: ${oldestUrl}`);
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
    this.ttl = ttl;
  }

  /**
   * Set max cache size
   */
  setMaxSize(maxSize: number): void {
    this.maxSize = maxSize;

    // Evict entries if cache is now too large
    while (this.cache.size > this.maxSize) {
      this.evictLRU();
    }
  }
}

