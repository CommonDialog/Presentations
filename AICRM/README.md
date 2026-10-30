# AICRM — AI Lead Generation & Contact Manager

AICRM is a full-stack TypeScript lead generation application powered by **Node.js + Express**, **React + Vite + Tailwind CSS**, and **Google Gemini API with Google Search grounding**.

> See [PRESENTATION.md](./PRESENTATION.md) for the live presentation setup and demo checklist.

## Required Google AI Setup

1. Generate a Gemini API key from **[Google AI Studio](https://aistudio.google.com/apikey)** under an active project (verify project billing/prepay balance at **[https://ai.studio/projects](https://ai.studio/projects)**).
2. Place it in `c:\Dev\AICRM\.env` under `GEMINI_API_KEY=...`.

## Starting & Stopping the App

- **Start (Separate Windows)**: Run `start.bat` or `.\start.ps1` (or `npm run start:windows`)
  - Backend API: `http://localhost:3001` (logs written to `logs/server.log`)
  - Frontend UI: `http://localhost:5173`
- **Stop All Processes**: Run `stop.bat` or `.\stop.ps1`
