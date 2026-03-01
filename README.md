# The Portal

A desktop file organizer for Windows. Define rules, and files get moved automatically as they land in watched folders.

No browser tabs, no cloud sync, no subscription. It sits in your system tray and does its job.

## Download

**[Download The Portal v1.0.0 for Windows](https://github.com/AmerSarhan/Portal-File-Organizer/releases/download/v1.0.0/The.Portal.Setup.1.0.0.exe)**

> Windows may show a SmartScreen warning since the app isn't code-signed. Click **"More info"** → **"Run anyway"**.

## What it does

You set up rules like:
- "Move `.pdf` files from Downloads to Documents"
- "Move files containing `invoice` to Accounting"
- "Move screenshots to a Screenshots folder"

The Portal watches those folders in real-time. When a new file appears that matches a rule, it moves it. Done.

## Features

**Core**
- Rule-based file matching by extension, filename substring, or both
- Real-time folder watching with automatic file moves
- "Organize Now" — one-click scan to organize files already sitting in folders
- Conflict handling — skip, rename with suffix (`-1`, `-2`), or overwrite
- Undo last move
- Persistent activity log and per-rule stats

**AI (optional, requires Anthropic API key)**
- Create rules with natural language — *"move PDFs from downloads to my documents"*
- AI image rename — Claude Vision analyzes images and gives them descriptive filenames instead of `IMG_20240301_142356.jpg`

**System**
- Runs in the system tray, minimizes to background
- Auto-start with Windows
- Native Windows notifications when files are moved
- Dashboard with move stats and 7-day activity chart

## Stack

- **Electron** — desktop runtime
- **React + TypeScript** — UI
- **Vite** — build tooling
- **chokidar** — file system watcher
- **Claude API** (Haiku) — AI features (optional)

## Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm start
```

This starts both the Vite dev server and Electron. The app opens automatically.

## Build installer

```bash
npm run dist
```

Outputs a Windows installer (`.exe`) to the `release/` folder. Uses `electron-builder` with NSIS.

## Project structure

```
electron/
  main.cjs        # Main process — file watching, IPC, tray, AI calls
  preload.cjs      # Context bridge between main and renderer
src/
  App.tsx          # UI — dashboard, rule editor, settings, activity log
  App.css          # Styles — teal/cyan dark theme
  types.ts         # TypeScript interfaces and Window.api declaration
```

Config is stored in `%APPDATA%/theportal/` — rules, stats, activity log, and API key are all local files. Nothing leaves your machine (except AI calls to Anthropic's API if you enable them).

## License

MIT
