/// <reference lib="webworker" />
/**
 * Sentence-meaning model, run off the main thread so the UI never stutters.
 * Downloads the model files once (cached by the browser); nothing is sent out.
 *
 * in:  { type: "load" } | { type: "embed", id, texts }
 * out: { type: "progress", pct } | { type: "ready" } | { type: "error" }
 *      | { type: "embedded", id, vectors }
 */
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

export const MODEL_ID = "Xenova/multilingual-e5-small";
// e5 models expect this prefix on every input.
const PREFIX = "query: ";

env.allowLocalModels = false;

// The library's generic pipeline() type is too large for tsc; we only need this one task.
const createExtractor = pipeline as unknown as (
  task: "feature-extraction",
  model: string,
  options: { dtype: string; progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => void },
) => Promise<FeatureExtractionPipeline>;

type InMsg = { type: "load" } | { type: "embed"; id: number; texts: string[] };

let extractor: Promise<FeatureExtractionPipeline> | null = null;
const fileProgress = new Map<string, { loaded: number; total: number }>();

function load(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    extractor = createExtractor("feature-extraction", MODEL_ID, {
      dtype: "q8",
      progress_callback: (p) => {
        if (p.status !== "progress" || !p.file || !p.total) return;
        fileProgress.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
        let loaded = 0;
        let total = 0;
        fileProgress.forEach((f) => {
          loaded += f.loaded;
          total += f.total;
        });
        self.postMessage({ type: "progress", pct: total ? Math.round((loaded / total) * 100) : 0 });
      },
    });
  }
  return extractor;
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      await load();
      self.postMessage({ type: "ready" });
    } else if (msg.type === "embed") {
      const model = await load();
      const out = await model(msg.texts.map((t) => PREFIX + t), { pooling: "mean", normalize: true });
      self.postMessage({ type: "embedded", id: msg.id, vectors: out.tolist() as number[][] });
    }
  } catch {
    extractor = null;
    self.postMessage({ type: "error", id: msg.type === "embed" ? msg.id : undefined });
  }
};
