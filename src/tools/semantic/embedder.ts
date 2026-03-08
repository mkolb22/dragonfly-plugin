/**
 * Embedding Model
 * Generates vector embeddings using local models or OpenAI.
 * On Apple Silicon (arm64 + darwin), routes inference through CoreML
 * execution provider — targeting the Neural Engine (ANE) for 5-10x
 * speedup over CPU with fp16 quantization.
 */

import { pipeline } from "@huggingface/transformers";

/** True when running on Apple Silicon Mac. */
const IS_APPLE_SILICON =
  process.platform === "darwin" && process.arch === "arm64";

/**
 * Build ONNX session options for the current platform.
 * CoreML execution provider routes ops to the ANE or GPU depending
 * on layer support. CPU is always listed as the fallback provider.
 */
function buildSessionOptions(): Record<string, unknown> {
  if (IS_APPLE_SILICON) {
    return {
      executionProviders: [
        { name: "coreml", deviceType: "npu" }, // ANE preferred
        "cpu",                                  // fallback
      ],
    };
  }
  return { executionProviders: ["cpu"] };
}

export class EmbeddingModel {
  private modelName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private embeddingPipeline: any = null;
  private initialized = false;
  private activeProvider = "cpu";

  constructor(modelName: string = "local") {
    this.modelName = modelName;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.modelName === "local") {
      const sessionOptions = buildSessionOptions();

      // fp16 on Apple Silicon — ANE processes fp16 natively, negligible
      // quality loss for cosine-similarity embedding tasks.
      const dtype = IS_APPLE_SILICON ? "fp16" : "fp32";

      try {
        this.embeddingPipeline = await pipeline(
          "feature-extraction",
          "Xenova/all-MiniLM-L6-v2",
          { dtype, session_options: sessionOptions }
        );
        this.activeProvider = IS_APPLE_SILICON ? "coreml" : "cpu";
      } catch {
        // CoreML initialisation failed — fall back to plain CPU fp32.
        this.embeddingPipeline = await pipeline(
          "feature-extraction",
          "Xenova/all-MiniLM-L6-v2",
          { dtype: "fp32", session_options: { executionProviders: ["cpu"] } }
        );
        this.activeProvider = "cpu (fallback)";
      }
    } else if (this.modelName === "openai") {
      // OpenAI embeddings handled in embed method
    } else {
      throw new Error(`Unknown embedding model: ${this.modelName}`);
    }

    this.initialized = true;
  }

  /** Returns the active ONNX execution provider (diagnostic). */
  getProvider(): string {
    return this.activeProvider;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.modelName === "local" && this.embeddingPipeline) {
      return this.embedLocal(text);
    } else if (this.modelName === "openai") {
      return this.embedOpenAI(text);
    }

    throw new Error("Embedding model not initialized");
  }

  private async embedLocal(text: string): Promise<number[]> {
    if (!this.embeddingPipeline) {
      throw new Error("Pipeline not initialized");
    }

    // Truncate text if too long (model max ~512 tokens)
    const maxLength = 2000;
    const truncatedText = text.length > maxLength ? text.substring(0, maxLength) : text;

    const result = await this.embeddingPipeline(truncatedText, {
      pooling: "mean",
      normalize: true,
    });

    // Convert to plain array - handle Tensor output from transformers v3
    const data = (result as { data: Float32Array }).data;
    return Array.from(data);
  }

  private async embedOpenAI(text: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY environment variable required for OpenAI embeddings"
      );
    }

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data[0].embedding;
  }

  getDimensions(): number {
    if (this.modelName === "local") {
      return 384; // all-MiniLM-L6-v2
    } else if (this.modelName === "openai") {
      return 1536; // text-embedding-3-small
    }
    return 384;
  }
}
