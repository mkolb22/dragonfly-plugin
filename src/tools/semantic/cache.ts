/**
 * EmbeddingCache
 *
 * Two-tier LRU cache (in-memory + optional SQLite) for embedding vectors.
 * Normalizes keys (lowercase, trimmed) for consistent lookups.
 * Supports TTL-based expiration, capacity-based LRU eviction,
 * transparent model wrapping, and persistence via SQLite.
 *
 * Key normalization: text.trim().toLowerCase() then SHA-256 hash.
 * Memory layer: Map-based LRU (JS Map preserves insertion order).
 * SQLite layer: embedding_cache table via BaseStore, optional.
 */

import { createHash } from "crypto";
import { BaseStore } from "../../core/store.js";
import { numberArrayToBytes, bytesToNumberArray } from "../../utils/vectors.js";
import type { EmbeddingModel } from "./embedder.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CacheMetrics {
  hit_count: number;
  miss_count: number;
  eviction_count: number;
  /** hit_count / (hit_count + miss_count); 0 when no lookups. */
  hit_rate: number;
}

export interface CacheOptions {
  /** LRU capacity. Default 1000. Must be > 0. */
  capacity?: number;
  /** Entry time-to-live in ms. Default 7 days. */
  ttlMs?: number;
  /** SQLite path. undefined = memory-only (no persistence). */
  dbPath?: string;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class EmbeddingCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingCacheError";
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface MemEntry {
  vector: number[];
  createdAt: number;
}

interface DbRow {
  vector: Buffer;
  created_at: number;
}

// ---------------------------------------------------------------------------
// SQLite persistence layer
// ---------------------------------------------------------------------------

class CacheStore extends BaseStore {
  constructor(dbPath: string) {
    super(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        key        TEXT    PRIMARY KEY,
        vector     BLOB    NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.ensureIndex("idx_ec_created", "embedding_cache", "created_at");
  }

  getEntry(key: string): DbRow | undefined {
    return this.queryOne<DbRow>(
      "SELECT vector, created_at FROM embedding_cache WHERE key = ?",
      [key],
    );
  }

  setEntry(key: string, vector: Buffer, createdAt: number): void {
    this.execute(
      "INSERT OR REPLACE INTO embedding_cache(key, vector, created_at) VALUES (?, ?, ?)",
      [key, vector, createdAt],
    );
  }

  deleteEntry(key: string): void {
    this.execute("DELETE FROM embedding_cache WHERE key = ?", [key]);
  }

  deleteExpired(cutoff: number): number {
    return this.execute(
      "DELETE FROM embedding_cache WHERE created_at < ?",
      [cutoff],
    ).changes;
  }

  clearAll(): void {
    this.clearTable("embedding_cache");
  }
}

// ---------------------------------------------------------------------------
// EmbeddingCache
// ---------------------------------------------------------------------------

export class EmbeddingCache {
  private readonly capacity: number;
  private readonly ttlMs: number;
  private readonly lru: Map<string, MemEntry>;
  private readonly store: CacheStore | null;

  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: CacheOptions = {}) {
    const capacity = options.capacity ?? 1000;
    if (capacity <= 0) throw new RangeError("capacity must be > 0");

    this.capacity = capacity;
    this.ttlMs = options.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
    this.lru = new Map();
    this.store = this.openStore(options.dbPath);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Return cached vector for text, or undefined on miss / expiry.
   * Promotes the entry to MRU position on hit.
   */
  get(text: string): number[] | undefined {
    const key = EmbeddingCache.cacheKey(text);
    const now = Date.now();

    // Memory layer
    const mem = this.lru.get(key);
    if (mem !== undefined) {
      if (now - mem.createdAt > this.ttlMs) {
        this.lru.delete(key);
        this.store?.deleteEntry(key);
        // fall through to miss
      } else {
        // LRU refresh: delete + re-insert moves entry to tail (MRU)
        this.lru.delete(key);
        this.lru.set(key, mem);
        this.hits++;
        return mem.vector;
      }
    }

    // SQLite layer
    if (this.store) {
      const row = this.store.getEntry(key);
      if (row) {
        if (now - row.created_at > this.ttlMs) {
          this.store.deleteEntry(key);
        } else {
          const vector = bytesToNumberArray(row.vector);
          this.insertMem(key, { vector, createdAt: row.created_at });
          this.hits++;
          return vector;
        }
      }
    }

    this.misses++;
    return undefined;
  }

  /**
   * Store vector for text. Evicts LRU entry if at capacity.
   * @throws EmbeddingCacheError when vector is empty.
   */
  set(text: string, vector: number[]): void {
    if (vector.length === 0) {
      throw new EmbeddingCacheError("Vector must not be empty");
    }

    const key = EmbeddingCache.cacheKey(text);
    const createdAt = Date.now();

    if (this.lru.has(key)) {
      this.lru.delete(key); // re-insert to refresh LRU position
    } else {
      this.evictIfFull();
    }
    this.lru.set(key, { vector, createdAt });

    if (this.store) {
      this.store.setEntry(key, numberArrayToBytes(vector), createdAt);
    }
  }

  /**
   * Wrap an EmbeddingModel with transparent caching.
   * The returned object is drop-in compatible with EmbeddingModel.
   */
  wrap(model: EmbeddingModel): {
    embed(text: string): Promise<number[]>;
    getDimensions(): number;
    getProvider(): string;
  } {
    return {
      embed: async (text: string): Promise<number[]> => {
        const cached = this.get(text);
        if (cached !== undefined) return cached;
        const vector = await model.embed(text);
        this.set(text, vector);
        return vector;
      },
      getDimensions: () => model.getDimensions(),
      getProvider: () => model.getProvider(),
    };
  }

  /** Snapshot of hit / miss / eviction counters. */
  metrics(): CacheMetrics {
    const total = this.hits + this.misses;
    return {
      hit_count: this.hits,
      miss_count: this.misses,
      eviction_count: this.evictions,
      hit_rate: total === 0 ? 0 : this.hits / total,
    };
  }

  /**
   * Empty both memory cache and SQLite table.
   * Resets all metric counters.
   */
  clear(): void {
    this.lru.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.store?.clearAll();
  }

  /**
   * Remove all entries past their TTL from memory and SQLite.
   * Returns total count of unique pruned entries.
   */
  prune(): number {
    const cutoff = Date.now() - this.ttlMs;

    // Collect expired keys from memory
    const expiredKeys = new Set<string>();
    for (const [key, entry] of this.lru) {
      if (entry.createdAt < cutoff) {
        expiredKeys.add(key);
      }
    }
    for (const key of expiredKeys) {
      this.lru.delete(key);
    }

    let count = expiredKeys.size;

    // SQLite: delete expired rows. Entries may overlap with memory,
    // so only count SQLite-only entries (those not already in expiredKeys).
    if (this.store) {
      const sqliteDeleted = this.store.deleteExpired(cutoff);
      // Some of the SQLite-deleted entries may have been in memory too.
      // Since we cannot cheaply determine the overlap, we take the max
      // of the two counts as a conservative estimate.
      if (sqliteDeleted > count) {
        count = sqliteDeleted;
      }
    }

    return count;
  }

  /** Close the underlying SQLite connection (if open). */
  close(): void {
    this.store?.close();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private openStore(dbPath?: string): CacheStore | null {
    if (!dbPath) return null;
    try {
      return new CacheStore(dbPath);
    } catch (err) {
      console.warn(
        `EmbeddingCache: SQLite unavailable (${(err as Error).message}), using memory-only`,
      );
      return null;
    }
  }

  private static cacheKey(text: string): string {
    return createHash("sha256")
      .update(text.trim().toLowerCase())
      .digest("hex");
  }

  private insertMem(key: string, entry: MemEntry): void {
    this.evictIfFull();
    this.lru.set(key, entry);
  }

  private evictIfFull(): void {
    if (this.lru.size >= this.capacity) {
      const oldest = this.lru.keys().next().value;
      if (oldest !== undefined) {
        this.lru.delete(oldest);
        this.evictions++;
      }
    }
  }
}
