import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import {
  EmbeddingCache,
  EmbeddingCacheError,
  type CacheOptions,
} from "./cache.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeModel(dims = 4, baseValue = 0.1) {
  const embed = vi.fn(async (_text: string) =>
    Array.from({ length: dims }, (_, i) => baseValue + i * 0.1)
  );
  return {
    embed,
    getDimensions: () => dims,
    getProvider: () => "test",
  };
}

function makeCache(opts: CacheOptions = {}) {
  return new EmbeddingCache({ capacity: 5, ...opts });
}

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `ec-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
}

// ─── Basic get / set ──────────────────────────────────────────────────────────

describe("EmbeddingCache — get / set", () => {
  let cache: EmbeddingCache;
  beforeEach(() => (cache = makeCache()));

  it("returns undefined for unknown key", () => {
    expect(cache.get("unknown")).toBeUndefined();
  });

  it("returns stored vector after set", () => {
    const v = [0.1, 0.2, 0.3];
    cache.set("hello", v);
    expect(cache.get("hello")).toEqual(v);
  });

  it("overwrites existing entry on re-set", () => {
    cache.set("x", [1]);
    cache.set("x", [2]);
    expect(cache.get("x")).toEqual([2]);
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("EmbeddingCache — validation", () => {
  it("throws EmbeddingCacheError for empty vector", () => {
    const c = makeCache();
    expect(() => c.set("x", [])).toThrow(EmbeddingCacheError);
    expect(() => c.set("x", [])).toThrow("Vector must not be empty");
  });

  it("throws RangeError for capacity 0", () => {
    expect(() => new EmbeddingCache({ capacity: 0 })).toThrow(RangeError);
  });

  it("throws RangeError for negative capacity", () => {
    expect(() => new EmbeddingCache({ capacity: -5 })).toThrow(RangeError);
  });
});

// ─── LRU eviction ─────────────────────────────────────────────────────────────

describe("EmbeddingCache — LRU eviction invariants", () => {
  it("invariant: evicts least-recently-used entry when at capacity", () => {
    const cache = new EmbeddingCache({ capacity: 3 });
    cache.set("a", [1]);
    cache.set("b", [2]);
    cache.set("c", [3]);
    // Access 'a' to promote it — 'b' becomes LRU
    cache.get("a");
    // Adding 'd' must evict 'b'
    cache.set("d", [4]);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toEqual([1]);
    expect(cache.get("c")).toEqual([3]);
    expect(cache.get("d")).toEqual([4]);
  });

  it("invariant: eviction_count increments once per eviction", () => {
    const cache = new EmbeddingCache({ capacity: 2 });
    cache.set("a", [1]);
    cache.set("b", [2]);
    cache.set("c", [3]); // evicts 'a'
    expect(cache.metrics().eviction_count).toBe(1);
    cache.set("d", [4]); // evicts 'b'
    expect(cache.metrics().eviction_count).toBe(2);
  });

  it("invariant: re-setting existing key does not count as eviction", () => {
    const cache = new EmbeddingCache({ capacity: 2 });
    cache.set("a", [1]);
    cache.set("a", [2]); // overwrite, not eviction
    expect(cache.metrics().eviction_count).toBe(0);
  });
});

// ─── TTL ──────────────────────────────────────────────────────────────────────

describe("EmbeddingCache — TTL", () => {
  it("returns undefined for expired entry", async () => {
    const cache = new EmbeddingCache({ capacity: 10, ttlMs: 30 });
    cache.set("x", [1, 2]);
    await new Promise((r) => setTimeout(r, 60));
    expect(cache.get("x")).toBeUndefined();
  });

  it("live entry within TTL is still returned", async () => {
    const cache = new EmbeddingCache({ capacity: 10, ttlMs: 5000 });
    const v = [0.5, 0.6];
    cache.set("y", v);
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.get("y")).toEqual(v);
  });
});

// ─── prune ────────────────────────────────────────────────────────────────────

describe("EmbeddingCache — prune", () => {
  it("removes expired entries and returns count", async () => {
    const cache = new EmbeddingCache({ capacity: 10, ttlMs: 30 });
    cache.set("a", [1]);
    cache.set("b", [2]);
    await new Promise((r) => setTimeout(r, 60));
    cache.set("c", [3]); // not expired
    const pruned = cache.prune();
    expect(pruned).toBeGreaterThanOrEqual(2);
    expect(cache.get("c")).toEqual([3]);
  });

  it("invariant: prune does not remove live entries", () => {
    const cache = new EmbeddingCache({ capacity: 10, ttlMs: 60_000 });
    cache.set("live", [1, 2, 3]);
    expect(cache.prune()).toBe(0);
    expect(cache.get("live")).toEqual([1, 2, 3]);
  });
});

// ─── Metrics invariants ───────────────────────────────────────────────────────

describe("EmbeddingCache — metrics invariants", () => {
  let cache: EmbeddingCache;
  beforeEach(() => (cache = makeCache()));

  it("invariant: hit_rate = hit_count / (hit_count + miss_count)", () => {
    cache.set("x", [1]);
    cache.get("x"); // hit
    cache.get("y"); // miss
    cache.get("x"); // hit
    cache.get("z"); // miss
    const m = cache.metrics();
    expect(m.hit_count).toBe(2);
    expect(m.miss_count).toBe(2);
    expect(m.hit_rate).toBeCloseTo(0.5, 9);
  });

  it("invariant: hit_rate is 0 with no lookups", () => {
    expect(cache.metrics().hit_rate).toBe(0);
  });

  it("invariant: hit_rate is 1 when every get is a hit", () => {
    cache.set("a", [1]);
    cache.get("a");
    cache.get("a");
    expect(cache.metrics().hit_rate).toBe(1);
  });

  it("invariant: hit_rate is 0 when every get is a miss", () => {
    cache.get("nope1");
    cache.get("nope2");
    expect(cache.metrics().hit_rate).toBe(0);
  });

  it("invariant: clear resets all counters to zero", () => {
    cache.set("a", [1]);
    cache.get("a");
    cache.get("b");
    cache.clear();
    const m = cache.metrics();
    expect(m.hit_count).toBe(0);
    expect(m.miss_count).toBe(0);
    expect(m.eviction_count).toBe(0);
    expect(m.hit_rate).toBe(0);
  });

  it("clear removes entries from memory", () => {
    cache.set("a", [1]);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
  });
});

// ─── Key normalization invariants ──────────────────────────────────────────────

describe("EmbeddingCache — key normalization invariants", () => {
  it("invariant: trimmed + lowercased text maps to same key", () => {
    const cache = makeCache();
    const v = [0.1, 0.2, 0.3];
    cache.set("Hello ", v);
    expect(cache.get("hello")).toEqual(v);
    expect(cache.get("  HELLO  ")).toEqual(v);
    expect(cache.get("Hello ")).toEqual(v);
  });

  it("invariant: distinct content produces distinct keys", () => {
    const cache = makeCache();
    cache.set("foo", [1]);
    cache.set("bar", [2]);
    expect(cache.get("foo")).toEqual([1]);
    expect(cache.get("bar")).toEqual([2]);
  });
});

// ─── wrap() ───────────────────────────────────────────────────────────────────

describe("EmbeddingCache — wrap()", () => {
  it("invariant: embed() called exactly once for repeated identical input", async () => {
    const cache = makeCache();
    const model = makeModel();
    const wrapped = cache.wrap(model as never);
    const v1 = await wrapped.embed("hello");
    const v2 = await wrapped.embed("hello");
    expect(v1).toEqual(v2);
    expect(model.embed).toHaveBeenCalledTimes(1);
  });

  it("invokes model for distinct inputs", async () => {
    const cache = makeCache();
    const model = makeModel();
    const wrapped = cache.wrap(model as never);
    await wrapped.embed("a");
    await wrapped.embed("b");
    expect(model.embed).toHaveBeenCalledTimes(2);
  });

  it("forwards getDimensions()", () => {
    const cache = makeCache();
    const wrapped = cache.wrap(makeModel(128) as never);
    expect(wrapped.getDimensions()).toBe(128);
  });

  it("forwards getProvider()", () => {
    const cache = makeCache();
    const wrapped = cache.wrap(makeModel() as never);
    expect(wrapped.getProvider()).toBe("test");
  });
});

// ─── SQLite persistence ───────────────────────────────────────────────────────

describe("EmbeddingCache — SQLite persistence", () => {
  let dbPath: string;
  const caches: EmbeddingCache[] = [];

  function openCache(opts: CacheOptions = {}) {
    const c = new EmbeddingCache({ capacity: 10, dbPath, ...opts });
    caches.push(c);
    return c;
  }

  beforeEach(() => {
    dbPath = tempDb();
    caches.length = 0;
  });

  afterEach(() => {
    for (const c of caches) c.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it("persists entries across independent instances", () => {
    const c1 = openCache();
    c1.set("persist-me", [0.5, 0.6, 0.7]);
    c1.close();
    caches.pop();

    const c2 = openCache();
    // float32 serialization introduces ~1e-7 rounding — use per-element toBeCloseTo
    const v = c2.get("persist-me");
    expect(v).toHaveLength(3);
    expect(v![0]).toBeCloseTo(0.5, 5);
    expect(v![1]).toBeCloseTo(0.6, 5);
    expect(v![2]).toBeCloseTo(0.7, 5);
  });

  it("clear() removes SQLite entries", () => {
    const c1 = openCache();
    c1.set("x", [1, 2]);
    c1.clear();
    c1.close();
    caches.pop();

    const c2 = openCache();
    expect(c2.get("x")).toBeUndefined();
  });

  it("prune() removes expired SQLite entries", async () => {
    const c1 = openCache({ ttlMs: 30 });
    c1.set("old", [1]);
    await new Promise((r) => setTimeout(r, 60));
    c1.prune();
    c1.close();
    caches.pop();

    const c2 = openCache({ ttlMs: 30 });
    expect(c2.get("old")).toBeUndefined();
  });

  it("populates memory cache from SQLite on get", () => {
    const c1 = openCache();
    c1.set("from-db", [9, 8, 7]);
    c1.close();
    caches.pop();

    const c2 = openCache();
    // First get loads from SQLite into memory
    const v = c2.get("from-db");
    expect(v).toEqual([9, 8, 7]);
    // Second get should be a memory hit (miss count stays 0)
    c2.get("from-db");
    expect(c2.metrics().hit_count).toBe(2);
    expect(c2.metrics().miss_count).toBe(0);
  });
});
