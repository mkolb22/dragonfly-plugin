/**
 * EmbeddingRefresher
 *
 * Incrementally re-embeds a project by comparing file hashes against
 * the VectorStore's recorded hashes. Only changed files are re-chunked
 * and re-embedded. Supports concurrency-limited parallel embedding
 * and optional EmbeddingCache integration.
 */

import { VectorStore } from "./store.js";
import { CodeChunker } from "./chunker.js";
import { EmbeddingModel } from "./embedder.js";
import { EmbeddingCache } from "./cache.js";
import type { CodeChunk } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RefresherOptions {
  projectRoot: string;
  store: VectorStore;
  model: EmbeddingModel;
  /** Max parallel embed() calls in flight. Default: 4. */
  concurrency?: number;
  /** Optional cache — if hit, skips embed() call. */
  cache?: EmbeddingCache;
}

export interface RefreshResult {
  filesChecked: number;
  filesChanged: number;
  filesUnchanged: number;
  chunksEmbedded: number;
  /** Chunks skipped because already in cache. */
  chunksSkipped: number;
  durationMs: number;
  /** Non-fatal per-file errors — processing continues on error. */
  errors: Array<{ file: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Semaphore — bounds concurrent async operations
// ---------------------------------------------------------------------------

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (limit < 1) throw new RangeError("Semaphore limit must be >= 1");
  }

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      // Transfer the slot directly — active count stays the same.
      next();
    } else {
      this.active--;
    }
  }
}

// ---------------------------------------------------------------------------
// EmbeddingRefresher
// ---------------------------------------------------------------------------

export class EmbeddingRefresher {
  private readonly projectRoot: string;
  private readonly store: VectorStore;
  private readonly model: EmbeddingModel;
  private readonly concurrency: number;
  private readonly cache?: EmbeddingCache;

  constructor(options: RefresherOptions) {
    this.projectRoot = options.projectRoot;
    this.store = options.store;
    this.model = options.model;
    this.concurrency = options.concurrency ?? 4;
    this.cache = options.cache;

    if (this.concurrency < 1) {
      throw new RangeError("concurrency must be >= 1");
    }
  }

  /**
   * Incrementally re-embed the project.
   * Only processes files whose hash differs from the store's recorded hashes.
   */
  async refresh(paths?: string[]): Promise<RefreshResult> {
    const start = Date.now();

    const result: RefreshResult = {
      filesChecked: 0,
      filesChanged: 0,
      filesUnchanged: 0,
      chunksEmbedded: 0,
      chunksSkipped: 0,
      durationMs: 0,
      errors: [],
    };

    // 1. Get existing hashes from store
    const existingHashes = this.store.getFileHashes();

    // 2. Chunk project incrementally — only changed files returned
    const chunker = new CodeChunker(this.projectRoot);
    const allChunks = await chunker.chunkProject({
      paths,
      incremental: true,
      previousHashes: existingHashes,
    });

    // 3. Group chunks by file
    const chunksByFile = new Map<string, CodeChunk[]>();
    for (const chunk of allChunks) {
      const file = chunk.metadata.file;
      let list = chunksByFile.get(file);
      if (!list) {
        list = [];
        chunksByFile.set(file, list);
      }
      list.push(chunk);
    }

    // 4. Count files
    //    filesChecked = changed + unchanged.
    //    The chunker only returns changed files, so we need to infer unchanged count.
    const changedFiles = chunksByFile.size;
    //    The total scanned files = keys in existingHashes + any new files.
    //    But we don't know exact total — we only know changed files from the chunker.
    //    However, the spec says "filesChecked" = all files the chunker examined.
    //    The chunker internally checks all files against previousHashes and only
    //    returns changed ones. The total files it examined is: changedFiles + unchanged.
    //    We can compute unchanged = existingHashes entries that are NOT in changedFiles.
    //    But new files (not in existingHashes) would also be in changedFiles.
    //    The simplest accurate approach: unchanged = (existing hash entries) - (changed files that were in existing hashes).
    const existingFileSet = new Set(Object.keys(existingHashes));
    let unchangedCount = 0;
    for (const file of existingFileSet) {
      if (!chunksByFile.has(file)) {
        unchangedCount++;
      }
    }

    result.filesChanged = changedFiles;
    result.filesUnchanged = unchangedCount;
    result.filesChecked = changedFiles + unchangedCount;

    // 5. Embed each file's chunks with concurrency control
    const semaphore = new Semaphore(this.concurrency);

    for (const [file, chunks] of chunksByFile) {
      try {
        const embedded: Array<{ chunk: CodeChunk; embedding: number[] }> = [];

        // Pre-allocate promise array for concurrent embedding within a file
        const embedPromises = chunks.map(async (chunk) => {
          // Check cache first
          if (this.cache) {
            const cached = this.cache.get(chunk.content);
            if (cached !== undefined) {
              result.chunksSkipped++;
              return { chunk, embedding: cached };
            }
          }

          // Acquire semaphore slot for model.embed()
          await semaphore.acquire();
          try {
            const embedding = await this.model.embed(chunk.content);

            // Store in cache if available
            if (this.cache) {
              this.cache.set(chunk.content, embedding);
            }

            result.chunksEmbedded++;
            return { chunk, embedding };
          } finally {
            semaphore.release();
          }
        });

        const results = await Promise.all(embedPromises);
        for (const r of results) {
          embedded.push(r);
        }

        // Write all embeddings for this file to the store
        if (embedded.length > 0) {
          this.store.addEmbeddings(embedded);
        }
      } catch (err) {
        result.errors.push({
          file,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    result.durationMs = Date.now() - start;
    return result;
  }
}
