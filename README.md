# BookForge

A modern web-based e-book management hub with audiobook generation and reading platform integrations.

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- **EPUB Management** — Upload, parse, and manage e-book files (EPUB, PDF, MOBI, TXT)
- **In-Browser Reader** — Read EPUB and TXT files directly in the browser with adjustable font size and chapter navigation
- **Audiobook Generation** — Convert books to audio using browser text-to-speech with configurable voices and speed
- **Auto Day/Night Theme** — Automatically switches between light and dark themes based on time of day (6am–7pm light, 7pm–6am dark), with manual override
- **EPUB Conversion** — Convert EPUB files to TXT or HTML formats
- **Tag Organization** — Organize your library with custom tags and filters
- **Search & Sort** — Search by title/author and sort by various criteria
- **Grid & List Views** — Toggle between visual grid and compact list layouts
- **Drag & Drop Upload** — Drop files anywhere on the page to upload

### Integrations

Sync your reading data across your favorite platforms:

| Platform | What Syncs |
|----------|-----------|
| **Readwise** | Highlights and annotations |
| **Notion** | Book metadata, progress, and highlights to a database |
| **GitHub** | Reading notes as markdown files in a repo |
| **Obsidian** | Frontmatter-rich markdown notes to your vault |

## Quick Start

```bash
# Clone the repo
git clone https://github.com/aalikes/bookforge.git
cd bookforge

# Install dependencies
npm install

# Create your .env file
cp .env.example .env

# Start the server
npm start
```

The app will be running at `http://localhost:3000`.

## Configuration

Copy `.env.example` to `.env` and configure the integrations you want to use:

```env
# Server
PORT=3000

# Readwise — get token at https://readwise.io/access_token
READWISE_ACCESS_TOKEN=

# Notion — create integration at https://www.notion.so/my-integrations
NOTION_API_KEY=
NOTION_DATABASE_ID=

# GitHub — create PAT at https://github.com/settings/tokens
GITHUB_TOKEN=
GITHUB_REPO=username/repo-name

# Obsidian — local vault path or REST API
OBSIDIAN_VAULT_PATH=/path/to/vault
OBSIDIAN_REST_API_KEY=
OBSIDIAN_REST_API_URL=http://localhost:27124
```

All integrations are optional — the app works fully without any configured.

## API Endpoints

### Books
- `GET /api/books` — List all books (supports `?search=`, `?tag=`, `?sort=`, `?order=`)
- `GET /api/books/:id` — Get book details
- `POST /api/books/upload` — Upload a book (multipart form, field: `book`)
- `PUT /api/books/:id` — Update book metadata
- `DELETE /api/books/:id` — Delete a book

### Reader
- `GET /api/books/:id/content` — Get book chapters (EPUB/TXT)
- `GET /api/books/:id/file` — Download the original file

### Progress & Highlights
- `GET /api/books/:id/progress` — Get reading progress
- `PUT /api/books/:id/progress` — Update reading progress
- `GET /api/books/:id/highlights` — List highlights
- `POST /api/books/:id/highlights` — Add a highlight
- `DELETE /api/highlights/:id` — Delete a highlight

### Tags
- `GET /api/tags` — List all tags with counts
- `POST /api/books/:id/tags` — Add tag to book
- `DELETE /api/books/:id/tags/:tag` — Remove tag

### Audiobook
- `POST /api/books/:id/tts/generate` — Generate TTS manifest
- `GET /api/books/:id/tts/files` — List generated audio files

### Integrations
- `GET /api/integrations/status` — Check which integrations are configured
- `POST /api/integrations/readwise/sync` — Sync book to Readwise
- `POST /api/integrations/notion/sync` — Sync book to Notion
- `POST /api/integrations/github/sync` — Sync book to GitHub
- `POST /api/integrations/obsidian/sync` — Sync book to Obsidian
- `POST /api/integrations/sync-all` — Sync to all configured integrations

### Conversion
- `POST /api/books/:id/convert` — Convert EPUB to another format (`{ "target_format": "txt" }`)

## Tech Stack

- **Backend:** Node.js, Express, SQLite (better-sqlite3)
- **Frontend:** Vanilla JavaScript SPA
- **EPUB Parsing:** epub2
- **TTS:** Browser Web Speech API
- **Styling:** Custom CSS with CSS variables, auto day/night theme

## License

MIT
