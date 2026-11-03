# Compendium

Eric's notes + reference-board app. Plain HTML/CSS/JS (ES modules), no build step.
Runs as an installable web app (PWA) on iPad, Android and Windows. Data is kept on each
device (IndexedDB) and synced through a "Compendium" folder in Google Drive.

## Files
- `index.html` – page shell (for real hosting). `preview.html` – same app, wrapped for a claude.ai artifact preview.
- `js/config.js` – app name, Drive folder name, Google Client ID, AI model names.
- `js/state.js` – notes/boards/media model, tags, search. `js/db.js` – IndexedDB.
- `js/note.js` – note editor. `js/board.js` – infinite canvas board. `js/importer.js` – VizRef .VRB / export import (includes a binary-plist parser).
- `js/sync.js` – Google Drive sync (drive.file scope). `js/ai.js` – Anthropic API: image tagging + Ask AI.
- `sw.js`, `manifest.webmanifest`, `icons/` – offline + install.

## Deploy (GitHub Pages)
1. Create a repo (e.g. `compendium`), upload these files, Settings → Pages → deploy from branch `main`, folder `/`.
2. The app URL is `https://<user>.github.io/compendium/`.

## Google Drive sync setup (one time)
1. console.cloud.google.com → create project "Compendium".
2. APIs & Services → Library → enable **Google Drive API**.
3. OAuth consent screen → External → app name, your email → add scope `.../auth/drive.file` → add yourself as a test user (or publish the app; drive.file is a non-sensitive scope).
4. Credentials → Create credentials → OAuth client ID → **Web application** → Authorized JavaScript origins: `https://<user>.github.io` → copy the Client ID.
5. Paste the Client ID into `js/config.js` (GOOGLE_CLIENT_ID) or into the app's Settings, then Settings → Connect Google Drive on each device.

## Notes
- Routes are plain hashes: `#all #notes #boards #ask #trash #prefs #tag-<name> #note-<id> #board-<id>`.
- Google access tokens last ~1 hour; when expired the sidebar shows "Tap to reconnect".
- Originals are removed from local storage after they are safely uploaded (toggle in Settings).
