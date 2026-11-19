"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { newId, saveRun, type Run } from "@/lib/db";
import { applyTiming, initialTiming, readTiming } from "@/lib/timing";

const TICK_MS = 250;

interface Options {
  projectId: string;
  pageCount: number;
  /** Script version in use when the rehearsal starts (fixed for the run, PRD §4.1). */
  scriptVersionId: string;
  targetSec?: number;
  /** Called after the run is saved. */
  onSaved: (run: Run) => void;
}

/** Rehearsal timing + saving, for running a rehearsal inside the editor. */
export function useRehearsal({ projectId, pageCount, scriptVersionId, targetSec, onSaved }: Options) {
  const [timing, dispatch] = useReducer(applyTiming, pageCount, initialTiming);
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const versionAtStart = useRef(scriptVersionId);
  const pending = useRef<Run | null>(null);

  const running = timing.status === "running";
  const active = timing.status === "running" || timing.status === "paused";

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  const stamp = () => {
    const at = Date.now();
    setNow(at);
    return at;
  };

  const start = (slide: number) => {
    versionAtStart.current = scriptVersionId;
    setSaveError(false);
    // Size the per-slide totals to the project (it may have loaded after this hook first ran).
    dispatch({ type: "reset", slideCount: pageCount });
    dispatch({ type: "start", at: stamp(), slide });
  };

  const togglePause = () => dispatch({ type: running ? "pause" : "resume", at: stamp() });

  const goTo = (slide: number) => {
    if (active) dispatch({ type: "goto", at: stamp(), slide });
  };

  const persist = async (run: Run) => {
    setSaving(true);
    setSaveError(false);
    try {
      await saveRun(run);
      pending.current = null;
      setSaving(false);
      dispatch({ type: "reset", slideCount: pageCount });
      onSaved(run);
    } catch {
      pending.current = run;
      setSaving(false);
      setSaveError(true);
    }
  };

  /** Ends the rehearsal; saves it if any time was recorded. Returns false if nothing was saved. */
  const finish = async (): Promise<boolean> => {
    const at = stamp();
    const ended = applyTiming(timing, { type: "end", at });
    dispatch({ type: "end", at });
    if (ended.runMs <= 0) {
      dispatch({ type: "reset", slideCount: pageCount });
      return false;
    }
    await persist({
      id: newId(),
      projectId,
      mode: "rehearsal",
      scriptVersionId: versionAtStart.current,
      startedAt: at - ended.runMs,
      endedAt: at,
      totalMs: ended.runMs,
      slideMs: ended.slideMs,
      visits: ended.visits,
      targetSec,
    });
    return true;
  };

  const retry = () => {
    if (pending.current) void persist(pending.current);
  };

  const { totalMs, slideMs } = readTiming(timing, now);

  return {
    status: timing.status,
    /** True from start until the run is saved (or discarded). */
    inProgress: timing.status !== "idle",
    paused: timing.status === "paused",
    slide: timing.slide,
    totalMs,
    slideMs,
    saving,
    saveError,
    start,
    togglePause,
    goTo,
    finish,
    retry,
  };
}
