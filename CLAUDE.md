# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 작업 규칙 (항상 지킬 것)

1. **기준 문서는 PRD(`SlideCue_MVP_PRD.md`)다.** PRD에 없는 기능은 만들지 않는다. 필요해 보이면 만들기 전에 먼저 묻는다.
2. **한 번에 한 단계만 구현하고, 단계가 끝나면 멈춘다.** 다음 단계로 넘어가지 않는다.
3. **단계가 끝나면** 바꾼 내용과, 사용자가 브라우저에서 직접 확인하는 방법(열 주소, 누를 버튼, 보여야 하는 결과)을 알려준다.
4. **사용자가 "확인했다"고 말하면** 그 단계를 커밋하고 GitHub(`origin` = github.com/cjanet0103/Slide-Cue, `main`)에 올린다. 확인 전에는 커밋·푸시하지 않는다.
5. **설명은 비개발자가 이해할 수 있는 한국어로** 한다. 전문 용어는 풀어서 쓴다.
6. **설치나 명령 실행이 필요하면** 무엇을 왜 하는지 한 줄로 먼저 설명한 뒤 실행한다.
7. **API 키 같은 비밀 값은 코드와 대화에 쓰지 않는다.** 필요하면 사용자가 직접 `.env.local`에 넣도록 안내한다.

## Project state

Project setup (Next.js 16, React 19, TypeScript, ESLint 9 flat config, Vitest 3) is done. The PRD is split into 5 stages, built one at a time per the rules above. Stage 1 is committed; stage 2 is built and awaiting the user's check.

| 단계 | 내용 | PRD 근거 / 인수 테스트 |
|---|---|---|
| 1 | **내 발표와 대본 준비** — 디자인 토큰, `/app` 편집 화면, PDF 등록·썸네일, 슬라이드별 대본 작성·자동 저장, `슬라이드별 대본 / 전체 대본` 전환(전체 대본은 기기 안에서 슬라이드별로 나누기), 대본 버전 | 화면 1 일부, §4.1, T1 |
| 2 | **연습 모드와 시간 기록** — `/app/present` 발표자 화면, 전체·슬라이드별 타이머, 일시정지, 목표 시간, 회차 저장, 직전 연습과 비교 | F1, §4.2, T2 |
| 3 | **녹음 보관과 회고** — 녹음 보관 선택, 슬라이드별 다시 듣기, 다시 들을 곳 표시, 회고 메모, 저장 실패 안내 | F1, §4.2·4.4, T3·T9 일부 |
| 4 | **실시간 스크립트 트래킹과 실전** — 기기 내 음성 인식, 구절 강조·수동 보정, 실전 모드, `/app/audience` 청중 화면, 자동 넘김 | F3, §4.3, T5·T6·T7·T9 |
| 5 | **실제 발화로 대본 다듬기 + 공개 페이지** — 원문/인식문/반영 문장 비교, 선택 문장만 반영, `/`·`/guides/presentation-rehearsal`, robots·sitemap | F2, §4.4·4.5, T4 |

Out of scope until asked: file export/import between devices (Should), long-pause detection and keywords (Could), GA4, whisper.cpp, payments. Payments, when added, go through Groble hosted payment links (see the PRD tech-stack table); what is paid for is still undecided, and how a no-login app verifies a purchase must be checked against what Groble offers first.

Commands (once dependencies are installed with `npm install`): `npm run dev`, `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` (single file: `npx vitest run src/lib/timing.test.ts`), `npm run gen:fixture` (3-page test PDF).

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

## Code layout

- `src/app/` routes; `/app/*` routes are client-heavy and carry `noindex` via `src/app/app/layout.tsx`.
- `src/lib/db.ts` — the single Dexie database. Add tables only by adding a new `db.version(n)` block; never edit an existing version's schema (users' IndexedDB data must upgrade cleanly).
- Script versions: a project points at `currentScriptVersionId`. Unlocked versions are edited in place; once a run uses a version it is `locked`, and the next edit copies it into a new version (`saveSlideScript` in `src/lib/db.ts`).
- `src/lib/pdf.ts` lazy-imports `pdfjs-dist` so the PDF engine only loads on app screens. PDF.js "display" renders wait for animation frames, so they stall in a hidden/background tab; `renderThumbnail` uses the "print" intent to avoid that.
- `src/lib/timing.ts` is the pure timing reducer (start/pause/resume/goto/end) used by the presenter screen; `timing.test.ts` encodes PRD T2. Runs are saved via `saveRun`, which also locks the script version used.
- Screens: `/app` (`EditorApp` → `Library` or `Workspace` with tabs 슬라이드별 대본 / 전체 대본 / 회차 기록), `/app/present` (`PresenterApp`, rehearsal). `?project=<id>&run=<id>` opens a project on its run history.
- Design tokens live as CSS variables in `src/app/globals.css`; components use CSS Modules next to the component.

## Testing (planned)

Vitest for unit tests (timer math, script matching); Playwright for browser flows (PDF upload → reopen results); Vercel Preview for release checks. Mic, recording and projector output need real-device testing — T5 (live tracking) cannot be passed by a manual demo.
