# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Archi Studio Post-Production is a browser-based SPA that uses Google's Gemini API to enhance architectural 3D renders. It offers task-specific AI generation (perspective, facade, masterplan, material board, technical detail), image analysis, upscaling, and a canvas annotation editor. The UI language is French.

## Commands

```bash
npm run dev       # Dev server at http://localhost:3000
npm run build     # Production build to dist/
npm run preview   # Preview production build
```

No test, lint, or format scripts are configured.

## Environment

The app requires a Gemini API key via `process.env.GEMINI_API_KEY` (set in `.env` / `.env.local`). It also supports Google AI Studio's `window.aistudio` environment for key injection.

## Architecture

### Key Files

- **`App.tsx`** (~1800 lines) — Entire app state, UI layout, and orchestration. Contains `IntroSequence` and `Workspace` sub-components inline.
- **`services/geminiService.ts`** — All Gemini API calls: `generateArchitecturalView()`, `analyzeArchitecturalImage()`, `upscaleArchitecturalImage()`, `generateStyleImages()`. Includes retry logic with exponential backoff.
- **`types.ts`** — Core types: `TaskType`, `HistoryItem`, `LoadingState`, `AppView`, `GeminiPart`.
- **`hooks/useApiKey.ts`** — API key validation and AI Studio environment detection.
- **`components/CanvasEditor.tsx`** — Canvas annotation tool with pencil/highlighter/eraser/pan and a 20-step undo/redo stack stored in refs.

### State & Data Flow

- All primary app state lives in `App.tsx` via `useState`. No global state library is used.
- `geminiService.ts` is a pure service layer (no React context/state).
- Images are processed client-side before API submission: base images resize to ≤2048px, reference images to ≤1024px, upscale inputs to ≤1536px.
- The app uses `gemini-2.0-flash-preview-image-generation` (or similar) for generation and `gemini-2.5-flash` for analysis — check `geminiService.ts` for the exact model IDs.

### AI Prompting Strategy

Each `TaskType` has a distinct system prompt inside `generateArchitecturalView()` that enforces **geometry locking** — the AI must preserve original architectural structure while enhancing materials, lighting, and realism. Generated images are designed as 1:1 Photoshop overlays.

### CSS / Styling

Tailwind CSS 3 is loaded via CDN `<script>` tag in `index.html` (not via PostCSS). Custom animations (`fadeIn`, `slideUp`, `fadeOut`) are defined in the Tailwind config block inside `index.html`. The `glass-panel` utility class provides frosted-glass styling.

### Module System

The project uses ES modules (`"type": "module"`). `index.html` uses an import map pointing to `aistudiocdn.com` for React, Gemini, and Lucide in production. Vite handles local resolution during dev. A `window.process` polyfill in `index.tsx` satisfies the Gemini client library's Node.js expectations.
