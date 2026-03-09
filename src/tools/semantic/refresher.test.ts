import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmbeddingRefresher, type RefreshResult, type RefresherOptions } from "./refresher.js";
import type { CodeChunk } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeChunk(overrides: Partial<CodeChunk> & { file?: string; name?: string } = {}): CodeChunk {
  const file = overrides.file ?? overrides.metadata?.file ?? "src/test.ts";
  const name = overrides.name ?? overrides.metadata?.name ?? "testFn";
  return {
    id: overrides.id ?? `${file}:1`,
    content: overrides.content ?? `function ${name}() {}`,
    hash: overrides.hash ?? "abc123",
    metadata: {
      file,
      language: "typescript",
      kind: "function",
      name,
      startLine: 1,
      endLine: 5,
      ...overrides.metadata,
    },
  };
}

function makeStore(hashes: Record<string, string> = {}) {
  return {
    getFileHashes: vi.fn(() => ({ ...hashes })),
    addEmbeddings: vi.fn(),
    getChunkCount: vi.fn(() => 0),
    clearVectors: vi.fn(),
    close: vi.fn(),
    search: vi.fn(() => []),
  };
}

function makeModel(dims = 4) {
  let callId = 0;
  return {
    embed: vi.fn(async (_text: string) => {
      callId++;
      return Array.from({ length: dims }, (_, i) => callId * 0.1 + i * 0.01);
    }),
    getDimensions: vi.fn(() => dims),
    getProvider: vi.fn(() => "test"),
  };
}

function makeCache() {
  const store = new Map<string, number[]>();
  return {
    get: vi.fn((text: string) => store.get(text)),
    set: vi.fn((text: string, vec: number[]) => { store.set(text, vec); }),
    wrap: vi.fn(),
    _store: store,
  };
}

/**
 * Mock CodeChunker via vi.mock. The chunkProject function is controlled
 * per-test through the module-level `mockChunkProject` variable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockChunkProject = vi.fn(async (_opts?: any) => [] as CodeChunk[]);

vi.mock("./chunker.js", () => ({
  CodeChunker: vi.fn().mockImplementation(() => ({
    chunkProject: (opts?: Record<string, unknown>) => mockChunkProject(opts),
  })),
}));

// ---------------------------------------------------------------------------
// Helper to build refresher with typed mocks
// ---------------------------------------------------------------------------

function makeRefresher(overrides: Partial<RefresherOptions> = {}) {
  const store = makeStore(overrides.store ? undefined : {});
  const model = makeModel();
  const opts: RefresherOptions = {
    projectRoot: "/test/project",
    store: (overrides.store ?? store) as unknown as RefresherOptions["store"],
    model: (overrides.model ?? model) as unknown as RefresherOptions["model"],
    concurrency: overrides.concurrency ?? 4,
    cache: overrides.cache as unknown as RefresherOptions["cache"],
  };
  const refresher = new EmbeddingRefresher(opts);
  return { refresher, store: (overrides.store ?? store) as ReturnType<typeof makeStore>, model: (overrides.model ?? model) as ReturnType<typeof makeModel> };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockChunkProject = vi.fn(async () => [] as CodeChunk[]);
});

// ─── Contract: only changed files are re-embedded ────────────────────────────

describe("contract: only changed files are re-embedded", () => {
  it("does not embed chunks from unchanged files", async () => {
    const store = makeStore({ "src/a.ts": "hash-a", "src/b.ts": "hash-b" });
    // chunker returns empty = no files changed
    mockChunkProject.mockResolvedValue([]);
    const model = makeModel();
    const { refresher } = makeRefresher({ store: store as never, model: model as never });

    const result = await refresher.refresh();

    expect(result.filesChanged).toBe(0);
    expect(result.filesUnchanged).toBe(2);
    expect(result.chunksEmbedded).toBe(0);
    expect(model.embed).not.toHaveBeenCalled();
    expect(store.addEmbeddings).not.toHaveBeenCalled();
  });

  it("embeds chunks only from files returned by chunker", async () => {
    const store = makeStore({ "src/a.ts": "old-hash" });
    const changedChunk = makeChunk({ file: "src/a.ts", content: "changed content", hash: "new-hash" });
    mockChunkProject.mockResolvedValue([changedChunk]);
    const model = makeModel();
    const { refresher } = makeRefresher({ store: store as never, model: model as never });

    const result = await refresher.refresh();

    expect(result.filesChanged).toBe(1);
    expect(result.chunksEmbedded).toBe(1);
    expect(model.embed).toHaveBeenCalledTimes(1);
    expect(model.embed).toHaveBeenCalledWith("changed content");
  });

  it("passes incremental: true and previousHashes to chunker", async () => {
    const hashes = { "src/x.ts": "h1" };
    const store = makeStore(hashes);
    mockChunkProject.mockResolvedValue([]);
    const { refresher } = makeRefresher({ store: store as never });

    await refresher.refresh(["src/"]);

    expect(mockChunkProject).toHaveBeenCalledWith({
      paths: ["src/"],
      incremental: true,
      previousHashes: hashes,
    });
  });
});

// ─── Contract: unchanged files count correctly ───────────────────────────────

describe("contract: unchanged files contribute to filesUnchanged", () => {
  it("counts files in existing hashes but not returned by chunker as unchanged", async () => {
    const store = makeStore({ "a.ts": "h1", "b.ts": "h2", "c.ts": "h3" });
    // Only c.ts changed
    mockChunkProject.mockResolvedValue([makeChunk({ file: "c.ts", hash: "h3-new" })]);
    const { refresher } = makeRefresher({ store: store as never });

    const result = await refresher.refresh();

    expect(result.filesChecked).toBe(3); // 1 changed + 2 unchanged
    expect(result.filesChanged).toBe(1);
    expect(result.filesUnchanged).toBe(2);
  });
});

// ─── Contract: cache integration ─────────────────────────────────────────────

describe("contract: cache skips model.embed()", () => {
  it("uses cached vector and does not call model.embed()", async () => {
    const cache = makeCache();
    const cachedContent = "cached function body";
    cache._store.set(cachedContent, [0.1, 0.2, 0.3, 0.4]);
    const store = makeStore({});
    const model = makeModel();
    const chunk = makeChunk({ content: cachedContent });
    mockChunkProject.mockResolvedValue([chunk]);

    const { refresher } = makeRefresher({ store: store as never, model: model as never, cache: cache as never });
    const result = await refresher.refresh();

    expect(result.chunksSkipped).toBe(1);
    expect(result.chunksEmbedded).toBe(0);
    expect(model.embed).not.toHaveBeenCalled();
    // But addEmbeddings should still be called with the cached vector
    expect(store.addEmbeddings).toHaveBeenCalledTimes(1);
    const args = store.addEmbeddings.mock.calls[0][0];
    expect(args).toHaveLength(1);
    expect(args[0].embedding).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("stores newly embedded vectors in cache", async () => {
    const cache = makeCache();
    const store = makeStore({});
    const model = makeModel();
    const chunk = makeChunk({ content: "new content" });
    mockChunkProject.mockResolvedValue([chunk]);

    const { refresher } = makeRefresher({ store: store as never, model: model as never, cache: cache as never });
    await refresher.refresh();

    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set.mock.calls[0][0]).toBe("new content");
  });

  it("mixes cached and uncached chunks in same file", async () => {
    const cache = makeCache();
    cache._store.set("cached body", [0.5, 0.5, 0.5, 0.5]);

    const store = makeStore({});
    const model = makeModel();
    const chunks = [
      makeChunk({ id: "f:1", content: "cached body", file: "f.ts" }),
      makeChunk({ id: "f:2", content: "uncached body", file: "f.ts" }),
    ];
    mockChunkProject.mockResolvedValue(chunks);

    const { refresher } = makeRefresher({ store: store as never, model: model as never, cache: cache as never });
    const result = await refresher.refresh();

    expect(result.chunksSkipped).toBe(1);
    expect(result.chunksEmbedded).toBe(1);
    expect(model.embed).toHaveBeenCalledTimes(1);
    expect(model.embed).toHaveBeenCalledWith("uncached body");
  });
});

// ─── Contract: concurrency limit ─────────────────────────────────────────────

describe("contract: at most N concurrent embed() calls", () => {
  it("never exceeds concurrency limit", async () => {
    const concurrency = 2;
    let active = 0;
    let maxActive = 0;

    const model = makeModel();
    model.embed.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      // Simulate some async work
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return [0.1, 0.2, 0.3, 0.4];
    });

    const store = makeStore({});
    // Create chunks across multiple files to test cross-file concurrency
    const chunks = Array.from({ length: 8 }, (_, i) =>
      makeChunk({ id: `file${i}.ts:1`, content: `content-${i}`, file: `file${i}.ts` })
    );
    mockChunkProject.mockResolvedValue(chunks);

    const { refresher } = makeRefresher({ store: store as never, model: model as never, concurrency });
    await refresher.refresh();

    expect(maxActive).toBeLessThanOrEqual(concurrency);
    expect(model.embed).toHaveBeenCalledTimes(8);
  });

  it("works correctly with concurrency of 1 (serial)", async () => {
    const store = makeStore({});
    const model = makeModel();
    const chunks = [
      makeChunk({ id: "a:1", content: "a", file: "a.ts" }),
      makeChunk({ id: "b:1", content: "b", file: "b.ts" }),
    ];
    mockChunkProject.mockResolvedValue(chunks);

    const { refresher } = makeRefresher({ store: store as never, model: model as never, concurrency: 1 });
    const result = await refresher.refresh();

    expect(result.chunksEmbedded).toBe(2);
    expect(model.embed).toHaveBeenCalledTimes(2);
  });
});

// ─── Contract: error isolation ───────────────────────────────────────────────

describe("contract: per-file error isolation", () => {
  it("continues processing after a file's embed fails", async () => {
    const store = makeStore({});
    const model = makeModel();
    let callCount = 0;
    model.embed.mockImplementation(async (text: string) => {
      callCount++;
      if (text === "bad content") throw new Error("embed failed");
      return [0.1, 0.2, 0.3, 0.4];
    });

    const chunks = [
      makeChunk({ id: "bad:1", content: "bad content", file: "bad.ts" }),
      makeChunk({ id: "good:1", content: "good content", file: "good.ts" }),
    ];
    mockChunkProject.mockResolvedValue(chunks);

    const { refresher } = makeRefresher({ store: store as never, model: model as never });
    const result = await refresher.refresh();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe("bad.ts");
    expect(result.errors[0].error).toBe("embed failed");
    // good.ts should still be embedded
    expect(result.chunksEmbedded).toBe(1);
    // addEmbeddings called for good.ts only
    expect(store.addEmbeddings).toHaveBeenCalledTimes(1);
  });

  it("records error message as string even for non-Error throws", async () => {
    const store = makeStore({});
    const model = makeModel();
    model.embed.mockImplementation(async () => {
      throw "string error";
    });

    mockChunkProject.mockResolvedValue([makeChunk({ file: "fail.ts" })]);

    const { refresher } = makeRefresher({ store: store as never, model: model as never });
    const result = await refresher.refresh();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBe("string error");
  });
});

// ─── Contract: store.addEmbeddings() called with results ─────────────────────

describe("contract: store.addEmbeddings() receives embedded chunks", () => {
  it("calls addEmbeddings with chunk and embedding pairs per file", async () => {
    const store = makeStore({});
    const model = makeModel();
    const chunks = [
      makeChunk({ id: "x:1", content: "func a", file: "x.ts" }),
      makeChunk({ id: "x:2", content: "func b", file: "x.ts" }),
    ];
    mockChunkProject.mockResolvedValue(chunks);

    const { refresher } = makeRefresher({ store: store as never, model: model as never });
    await refresher.refresh();

    expect(store.addEmbeddings).toHaveBeenCalledTimes(1);
    const items = store.addEmbeddings.mock.calls[0][0] as Array<{ chunk: CodeChunk; embedding: number[] }>;
    expect(items).toHaveLength(2);
    expect(items[0].chunk.id).toBe("x:1");
    expect(items[0].embedding).toHaveLength(4);
    expect(items[1].chunk.id).toBe("x:2");
  });

  it("calls addEmbeddings once per changed file", async () => {
    const store = makeStore({});
    const model = makeModel();
    const chunks = [
      makeChunk({ file: "a.ts", id: "a:1" }),
      makeChunk({ file: "b.ts", id: "b:1" }),
      makeChunk({ file: "c.ts", id: "c:1" }),
    ];
    mockChunkProject.mockResolvedValue(chunks);

    const { refresher } = makeRefresher({ store: store as never, model: model as never });
    await refresher.refresh();

    expect(store.addEmbeddings).toHaveBeenCalledTimes(3);
  });
});

// ─── Contract: durationMs ────────────────────────────────────────────────────

describe("contract: durationMs measures wall-clock time", () => {
  it("durationMs >= 0", async () => {
    mockChunkProject.mockResolvedValue([]);
    const { refresher } = makeRefresher();

    const result = await refresher.refresh();

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("durationMs reflects actual elapsed time", async () => {
    const model = makeModel();
    model.embed.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return [0.1, 0.2, 0.3, 0.4];
    });

    mockChunkProject.mockResolvedValue([makeChunk()]);
    const store = makeStore({});
    const { refresher } = makeRefresher({ store: store as never, model: model as never });

    const result = await refresher.refresh();

    expect(result.durationMs).toBeGreaterThanOrEqual(40); // allow some slack
  });
});

// ─── Contract: paths filter ──────────────────────────────────────────────────

describe("contract: paths filter passed to chunker", () => {
  it("passes paths array to chunkProject", async () => {
    mockChunkProject.mockResolvedValue([]);
    const { refresher } = makeRefresher();

    await refresher.refresh(["src/tools/", "src/core/"]);

    expect(mockChunkProject).toHaveBeenCalledWith(
      expect.objectContaining({ paths: ["src/tools/", "src/core/"] })
    );
  });

  it("passes undefined paths when not provided", async () => {
    mockChunkProject.mockResolvedValue([]);
    const { refresher } = makeRefresher();

    await refresher.refresh();

    expect(mockChunkProject).toHaveBeenCalledWith(
      expect.objectContaining({ paths: undefined })
    );
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles empty project (no files)", async () => {
    mockChunkProject.mockResolvedValue([]);
    const { refresher } = makeRefresher();

    const result = await refresher.refresh();

    expect(result.filesChecked).toBe(0);
    expect(result.filesChanged).toBe(0);
    expect(result.filesUnchanged).toBe(0);
    expect(result.chunksEmbedded).toBe(0);
    expect(result.chunksSkipped).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("handles new files not in existing hashes", async () => {
    const store = makeStore({}); // no existing hashes
    const model = makeModel();
    mockChunkProject.mockResolvedValue([
      makeChunk({ file: "new.ts", content: "new file" }),
    ]);

    const { refresher } = makeRefresher({ store: store as never, model: model as never });
    const result = await refresher.refresh();

    expect(result.filesChanged).toBe(1);
    expect(result.filesUnchanged).toBe(0);
    expect(result.chunksEmbedded).toBe(1);
  });

  it("rejects concurrency < 1", () => {
    expect(() => {
      new EmbeddingRefresher({
        projectRoot: "/test",
        store: makeStore() as never,
        model: makeModel() as never,
        concurrency: 0,
      });
    }).toThrow(RangeError);
  });

  it("default concurrency is 4", async () => {
    // Just verify construction succeeds without explicit concurrency
    const refresher = new EmbeddingRefresher({
      projectRoot: "/test",
      store: makeStore() as never,
      model: makeModel() as never,
    });
    mockChunkProject.mockResolvedValue([]);
    const result = await refresher.refresh();
    expect(result).toBeDefined();
  });
});

// ─── Invariant: result fields sum correctly ──────────────────────────────────

describe("invariant: result field consistency", () => {
  it("invariant: filesChecked = filesChanged + filesUnchanged", async () => {
    const store = makeStore({ "a.ts": "h1", "b.ts": "h2" });
    mockChunkProject.mockResolvedValue([makeChunk({ file: "a.ts" })]);
    const { refresher } = makeRefresher({ store: store as never });

    const result = await refresher.refresh();

    expect(result.filesChecked).toBe(result.filesChanged + result.filesUnchanged);
  });

  it("invariant: chunksEmbedded + chunksSkipped = total chunks processed (with cache)", async () => {
    const cache = makeCache();
    cache._store.set("cached", [0.1, 0.2, 0.3, 0.4]);

    const store = makeStore({});
    const model = makeModel();
    const chunks = [
      makeChunk({ id: "f:1", content: "cached", file: "f.ts" }),
      makeChunk({ id: "f:2", content: "uncached", file: "f.ts" }),
    ];
    mockChunkProject.mockResolvedValue(chunks);

    const { refresher } = makeRefresher({ store: store as never, model: model as never, cache: cache as never });
    const result = await refresher.refresh();

    expect(result.chunksEmbedded + result.chunksSkipped).toBe(chunks.length);
  });

  it("invariant: errors array length <= filesChanged", async () => {
    const store = makeStore({});
    const model = makeModel();
    model.embed.mockRejectedValue(new Error("fail"));

    const chunks = [
      makeChunk({ file: "a.ts" }),
      makeChunk({ file: "b.ts" }),
    ];
    mockChunkProject.mockResolvedValue(chunks);

    const { refresher } = makeRefresher({ store: store as never, model: model as never });
    const result = await refresher.refresh();

    expect(result.errors.length).toBeLessThanOrEqual(result.filesChanged);
  });
});

// ─── Benchmark ───────────────────────────────────────────────────────────────

describe("benchmark: refresh throughput", () => {
  it("processes 100 chunks efficiently", async () => {
    const store = makeStore({});
    const model = makeModel();
    model.embed.mockImplementation(async () => [0.1, 0.2, 0.3, 0.4]);

    const chunks = Array.from({ length: 100 }, (_, i) =>
      makeChunk({ id: `file:${i}`, content: `content ${i}`, file: `file${i}.ts` })
    );
    mockChunkProject.mockResolvedValue(chunks);

    const { refresher } = makeRefresher({ store: store as never, model: model as never, concurrency: 8 });

    const start = Date.now();
    const result = await refresher.refresh();
    const elapsed = Date.now() - start;

    expect(result.chunksEmbedded).toBe(100);
    expect(elapsed).toBeLessThan(5000); // should be well under 5s with mocked embed
    expect(model.embed).toHaveBeenCalledTimes(100);
  });
});
