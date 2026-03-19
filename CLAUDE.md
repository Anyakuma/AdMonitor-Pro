# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AdMonitor Pro is a full-stack radio monitoring application that detects and records trigger words from audio streams. It features advanced speech recognition with phoneme expansion, voice activity detection, homophone matching, and n-gram analysis to improve keyword detection accuracy across different accents and speech patterns.

## Common Commands

### Development

```bash
npm run dev                # Start development server (tsx watches server.ts, Vite hot reload)
npm run build             # Build for production (vite build - outputs to dist/)
npm run preview           # Preview production build locally
npm run clean             # Remove dist/ directory
npm run lint              # Type checking with TypeScript (tsc --noEmit)
npm start                 # Run production server built with Node
```

### Running Single Files

- Run a specific TypeScript file in development: `tsx src/path/to/file.ts`
- The server automatically reloads via tsx when server.ts changes
- React components have hot module reload (HMR) in development via Vite

### Database

Database initialization happens automatically in `server.ts:initializeDatabase()`:
- Creates tables: `settings`, `keywords`, `recordings`
- Inserts default keywords: Guinness, Hennessy, Promotion, Sale
- PostgreSQL is used with fallback tolerance for development without network access

## Architecture

### Full-Stack Structure

**Frontend (React + TypeScript + Vite):**
- `src/App.tsx` - Main application component containing the entire speech recognition system
- `src/main.tsx` - Entry point
- `src/assets/` - Static assets
- Built with Tailwind CSS (via `@tailwindcss/vite` plugin)
- Uses Lucide React for icons, Framer Motion for animations, Sonner for toast notifications

**Backend (Express + PostgreSQL):**
- `server.ts` - Express server with three main API route groups:
  - `GET/POST/DELETE /api/keywords` - Manage keywords monitored for detection
  - `GET/POST/DELETE /api/recordings` - Manage audio recordings triggered by keyword detection
  - Vite middleware integration in development mode; static `dist/` serving in production
- Database: PostgreSQL via `pg` pool with connection string from `DATABASE_URL` env var

### Key Technical Decisions

**Speech Recognition Pipeline (Advanced Detection):**
The main App.tsx implements a sophisticated keyword detection engine with multiple layers:

1. **Phoneme Expansion** - Generates accent/fast-speech variants (vowel shifts, consonant substitutions) automatically when keywords are added
2. **Voice Band Filtering** - Applies 280–3800 Hz bandpass filter to strip music/rumble before recognition
3. **Voice Activity Detection (VAD)** - RMS energy gate suppresses recognition during non-speech gaps
4. **Homophone Dictionary** - Maps brand names to common phonetic variants (e.g., "Coca-Cola" → "coke", "cola")
5. **N-gram Sliding Window** - Detects keywords split across phrase boundaries using last 4 recognition results
6. **Multi-hypothesis Voting** - Checks all 8 Web Speech alternatives, produces vote-weighted confidence score
7. **Syllable Guard** - Prevents single phoneme matches on unrelated common words
8. **Per-keyword Cooldown** - 10-second minimum between duplicate triggers for same keyword
9. **Dynamic Grammar Refresh** - Web Speech grammar rebuilds when keywords change during listening
10. **Adaptive Noise Floor** - VAD threshold calibrates to ambient noise in first 3 seconds

**Audio Recording:**
- Circular PCM buffer stores 90 seconds of audio at all times
- On trigger, captures exactly 30 seconds before and 30 seconds after trigger word (60 seconds total)
- Records as audio/wav with base64 encoding for database storage

**Build & Deployment:**
- Vite configuration with React plugin and Tailwind CSS Vite plugin
- TypeScript strict mode (tsconfig.app.json, tsconfig.node.json)
- ESLint configured with TypeScript support, React Hooks, and React Refresh rules
- Path alias: `@` resolves to root directory

### Environment Variables

Required for operation:
- `DATABASE_URL` - PostgreSQL connection string (with `ssl: { rejectUnauthorized: false }` in production)
- `PORT` - Server port (default: 3002)
- `NODE_ENV` - Set to "production" for production builds
- `GEMINI_API_KEY` - API key (exposed client-side via Vite config, used in analytics)
- `DISABLE_HMR` - Set to 'true' to disable Vite HMR (used in AI Studio)

See `.env.example` for template.

### Database Schema

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE keywords (
  id SERIAL PRIMARY KEY,
  word TEXT UNIQUE NOT NULL
);

CREATE TABLE recordings (
  id TEXT PRIMARY KEY,
  triggerWord TEXT NOT NULL,
  duration REAL NOT NULL,
  timestamp TEXT NOT NULL,
  audioBase64 TEXT NOT NULL,
  size INTEGER NOT NULL,
  confidence TEXT DEFAULT 'Strong'
);
```

### File Watching & Development

- `vite.config.ts` configures HMR for localhost:5173 (disabled via `DISABLE_HMR` env)
- `server.ts` uses `express.static("dist")` in production, Vite middleware in development
- Max payload size for JSON requests set to 50MB for audio base64 uploads

## Notable Technologies

- **React 19** with TypeScript 5.8
- **Vite 6** with Tailwind CSS 4 Vite plugin
- **Web Speech API** for speech recognition (enhanced with custom phoneme/homophone matching)
- **better-sqlite3** and **pg** for database support (pg used in production)
- **JSZip** and **file-saver** for audio export functionality
- **Framer Motion** (motion package) for animations
- **Sonner** for toast notifications
- **date-fns** for date formatting
