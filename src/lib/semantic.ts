/**
 * Main-thread wrapper around the sentence-meaning worker
 * (src/workers/embedder.worker.ts). Loaded only when script tracking is used.
 * Text never leaves the device; only the model files are downloaded (once).
 */

export type SemanticState = "idle" | "loading" | "ready" | "error";

type Listener = (state: SemanticState, pct: number) => void;

let worker: Worker | null = null;
let state: SemanticState = "idle";
let pct = 0;
let nextId = 1;
const listeners = new Set<Listener>();
const pending = new Map<number, { resolve: (v: number[][]) => void; reject: () => void }>();
const vectorCache = new Map<string, number[]>();

function emit() {
  listeners.forEach((l) => l(state, pct));
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/embedder.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { type: "progress"; pct: number }
        | { type: "ready" }
        | { type: "error"; id?: number }
        | { type: "embedded"; id: number; vectors: number[][] };
      if (msg.type === "progress") {
        pct = msg.pct;
        emit();
      } else if (msg.type === "ready") {
        state = "ready";
        pct = 100;
        emit();
      } else if (msg.type === "error") {
        if (msg.id !== undefined) pending.get(msg.id)?.reject();
        else {
          state = "error";
          emit();
        }
      } else if (msg.type === "embedded") {
        pending.get(msg.id)?.resolve(msg.vectors);
        pending.delete(msg.id);
      }
    };
    worker.onerror = () => {
      state = "error";
      emit();
    };
  }
  return worker;
}

/** Start downloading/loading the model (no-op if already loading or ready). */
export function prepareSemantic(): void {
  if (typeof window === "undefined" || typeof Worker === "undefined") return;
  if (state === "loading" || state === "ready") return;
  state = "loading";
  pct = 0;
  emit();
  getWorker().postMessage({ type: "load" });
}

export function semanticState(): { state: SemanticState; pct: number } {
  return { state, pct };
}

export function onSemanticState(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Sentence vectors (unit length). Cached per text. Rejects if the model isn't usable. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (state !== "ready") throw new Error("model not ready");
  const missing = [...new Set(texts.filter((t) => !vectorCache.has(t)))];
  if (missing.length) {
    const id = nextId++;
    const vectors = await new Promise<number[][]>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      getWorker().postMessage({ type: "embed", id, texts: missing });
    });
    missing.forEach((t, i) => vectorCache.set(t, vectors[i]));
  }
  return texts.map((t) => vectorCache.get(t)!);
}

/** Embeds one window of speech without caching (it changes constantly). */
export async function embedOnce(text: string): Promise<number[]> {
  if (state !== "ready") throw new Error("model not ready");
  const id = nextId++;
  const [v] = await new Promise<number[][]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: "embed", id, texts: [text] });
  });
  return v;
}

/** Cosine similarity of two unit vectors. */
export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
