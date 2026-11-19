# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

SlideCue is **pre-implementation**. The folder holds only two spec documents; there is no code, `package.json`, build, lint or test setup yet. Build commands below are the *planned* stack from the PRD — verify they exist before running them.

- `SlideCue_MVP_PRD.md` — the product spec (Korean, v0.5). Source of truth for features, processing rules (§4) and acceptance tests T1–T9 (§5.1). Read the relevant section before implementing a feature.
- `DESIGN-notion (1).md` — visual design tokens (Notion-style: warm `#f6f5f4` canvas, Inter, single blue `#0075de` accent for CTAs/links only, sticker colors decorative only, hairline + barely-there shadows, pill CTAs vs 8px utility buttons vs 4px inputs). Use its front-matter tokens for UI styling.

Note: git resolves to a repo rooted at the user's home directory (`C:\Users\cjane`), not this folder. Don't commit from here without checking with the user; a project-local `git init` is likely wanted first.

## What the product is

A presentation rehearsal + live-delivery web app for university students and startup founders. Three features:
- **F1** — rehearsal timer (total + per-slide), runs (회차) compared side by side, optional recording with per-slide playback.
- **F2** — compare the written script against the speech-recognition transcript of what was actually said; user picks sentences to apply to the script, creating a new script version.
- **F3** — live script tracking: highlight the current phrase as the speaker talks; optional `자동 넘김` (auto-advance) moves presenter + audience windows to the next slide.

Laptop and iPad (landscape/portrait) only; smartphones are out of scope. No login, no server-side user data.

## Planned architecture (from PRD §1)

- **Next.js App Router + React + TypeScript + CSS Modules, deployed as one Vercel project.** Public pages (`/`, `/guides/presentation-rehearsal`) are statically generated and must be readable with JS disabled. App routes: `/app` (list + editor + run history), `/app/present` (presenter), `/app/audience` (audience window). App routes get `noindex` but must **not** be blocked in `robots.txt`.
- **Everything runs client-side.** PDF.js renders slides (current + adjacent first). IndexedDB via Dexie.js stores projects, script versions, runs, transcripts and opt-in audio chunks. getUserMedia + MediaRecorder for recording, saved in chunks.
- **Presenter ↔ audience sync** uses `BroadcastChannel` (same origin, same machine), sending session id + slide number only. The audience window must never receive script, transcript, notes or recording state.
- **Speech recognition**: Web Speech API with `processLocally = true` only. If on-device recognition isn't available, fall back to "수동 진행" (manual mode) — **never silently fall back to a cloud speech API**. whisper.cpp WASM in a Web Worker is a candidate fallback, lazy-loaded and cached per version.
- PDF engine and speech models must load only when their feature opens (public homepage first load: zero such requests).

## Invariants that span multiple features

These come from PRD §4 and are easy to break:
- **Versioning**: each run records the PDF + script version it started with. Editing the script creates a new version; past runs keep their original script/transcript/audio alignment.
- **Timing (§4.2)**: total = start→end minus explicit pauses only (silence counts). Revisiting a slide accumulates its time; audio is replayable per visit in order. Acceptance T2: 20s on slide 1, 10s pause, 30s slide 2, 5s slide 1 → total 55s, slide 1 25s, slide 2 30s.
- **Recognition and recording are independent toggles.** Timing is always saved; transcript only if recognition is on; raw audio only if `녹음 보관` is on.
- **Matching (§4.3)**: normalize (whitespace, punctuation, case) for comparison only, keep display text unchanged. Compare current phrase, 1 before, 2 after. Korean → contiguous character n-grams; English → word overlap + order. Hold position on silence, ambiguous ad-libs, or matches on only a number/common conjunction. Never advance highlight based on elapsed time. Manual slide change discards pending recognition for the previous slide. Auto-advance fires once, only when the end of the current slide and the start of the next are both confirmed.
- **Privacy**: PDF, script, audio and transcripts never leave the browser. File names and script text must not appear in URLs, analytics events or error logs. GA4 events use fixed paths/step names only; `first_rehearsal_completed` fires once after the first run with duration > 0 is persisted. Exclude audience window and preview deployments from analytics.
- **Storage failures**: report which items saved vs. failed; a failed audio save must not lose the script or other runs. Test IndexedDB schema upgrades against existing data before releasing.

## Testing (planned)

Vitest for unit tests (timer math, script matching); Playwright for browser flows (PDF upload → reopen results); Vercel Preview for release checks. Mic, recording and projector output need real-device testing — T5 (live tracking) cannot be passed by a manual demo.
