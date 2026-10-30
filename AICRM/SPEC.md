# AI Lead Generation Application (`AICRM`) — Specification

## 1. Overview
**AICRM** is a web-based lead generation and contact management application. Users log in, view saved lead lists by name, and run AI-powered searches (e.g., *"KC Plumbers"* with criteria *"plumbers within 25 miles of the Kansas City area"*). Each search uses the **Google Gemini API with Google Search grounding** to combine model knowledge and live web search results, returning 20 structured leads saved directly to local JSON storage.

## 2. Tech Stack & Architecture
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS, Lucide Icons
- **Backend**: Node.js, Express, TypeScript (`tsx` for dev, `tsc` for build), `@google/genai` SDK
- **Authentication**: Single-user credentials configured via `.env` (`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`)
- **Persistence**: Local file system JSON storage (`data/lists.json`) with atomic file writes (write to `.tmp` then rename)

## 3. Data Models

### `Contact` (Lead)
- `id`: string (UUID v4)
- `businessName`: string
- `contactName`: string
- `contactTitle`: string
- `phone`: string
- `email`: string
- `website`: string
- `address`: string
- `description`: string
- `sourceUrl`: string
- `notes`: string
- `status`: `'New' | 'Contacted' | 'Qualified' | 'Disqualified'`
- `createdAt`: string (ISO 8601)
- `updatedAt`: string (ISO 8601)

### `LeadList`
- `id`: string (UUID v4)
- `name`: string
- `criteria`: string
- `createdAt`: string (ISO 8601)
- `updatedAt`: string (ISO 8601)
- `contacts`: `Contact[]`

## 4. REST API Specification
- `POST /api/auth/login` — Authenticate with username & password, receive JWT token
- `GET /api/auth/me` — Verify active token and return current session info + API key status
- `POST /api/auth/settings` — Optional runtime update of Gemini API Key
- `GET /api/lists` — Get all saved lists (summary + contact counts)
- `GET /api/lists/:id` — Get a single `LeadList` with all contacts
- `POST /api/lists/search` — Execute AI + Google Search grounding for 20 leads and save as a new list
- `POST /api/lists/:id/append` — Execute AI + Google Search grounding for 20 additional non-duplicate leads and append to list
- `PATCH /api/lists/:id` — Update list name or criteria
- `DELETE /api/lists/:id` — Delete a list and its contacts
- `GET /api/lists/:id/export` — Export list contacts as a CSV file
- `POST /api/lists/:id/contacts` — Manually add a contact to a list
- `PATCH /api/lists/:id/contacts/:contactId` — Update a contact's details, status, or notes
- `DELETE /api/lists/:id/contacts/:contactId` — Delete an individual contact from a list
