# Friendly Launcher (pywebview window + startup mode chooser + app icon) — Design

> **Status:** approved design → ready for implementation plan.
> **Date:** 2026-05-29
> **Track:** Phase 3 «Diffusion» / ROADMAP **D1** (finaliser le launcher pywebview).
> Unrelated to the durable-notes (R11/R12) work shipped the same day.

## Goal

Replace the current systray launcher with a friendlier, app-like experience:
double-clicking the launcher opens the app in a **dedicated desktop window**
(pywebview), shows a **splash** while the (slow) servers boot, then loads the web
UI, which greets the user with a **Standard / Mode IA chooser**. The launcher,
its `.exe`, the window, and the browser favicon all share **one icon** — the
existing book mark (`frontend/public/favicon.svg`).

## Approved decisions

| Decision | Choice |
|----------|--------|
| Window technology | **pywebview** desktop window (EdgeChromium/WebView2 backend) |
| WebView2 runtime | **Bundle** Microsoft's Evergreen bootstrapper; auto-install on first run if missing |
| Close behavior | **Window-only** — closing the window stops both servers and quits. No tray. |
| Mode selection | In-app **ModeChooser** overlay, shown **every launch**, last pick preselected; existing top-bar toggle kept for later switching |
| Icon | Book mark from `favicon.svg` → `assets/app.ico` for `.exe`/taskbar/window; splash reuses the SVG directly |
| Standalone? | No — still requires `.venv` + `node_modules` (out of scope, not requested) |

## Architecture (units, each independently testable/understandable)

### 1. `launcher_core.py` (new, GUI-free)
Lifts today's `LauncherAPI` server logic out of `launcher.py` so it has no GUI
dependency and can be unit-tested.

Responsibilities:
- `pick_port(candidates) -> int | None` — first free TCP port.
- `write_env_local(root, backend_port)` — writes `frontend/.env.local` with `VITE_API_BASE`.
- `classify_ready_line(label, line) -> bool` — pure: is this a backend/frontend "ready" line? (`"Application startup complete"` for backend; `"ready in"` / `"Local:"` for frontend).
- `ServerManager` — `start()` (pick ports, write env, spawn `uvicorn` + `npm run dev` with `_CREATE_NO_WINDOW`, stream stdout to detect readiness), `stop()` (psutil tree-kill, fallback terminate/kill), status flags, `frontend_url`. Exposes an `on_ready`/`on_error` callback hook.
- Preconditions check: `missing_prereqs(root) -> list[str]` (no `.venv/Scripts/python.exe`, no `frontend/node_modules`).

### 2. `launcher.py` (rewritten, thin GUI shell)
- On start: ensure WebView2 (see §WebView2), then `webview.create_window("PDF Viewer", html=SPLASH_HTML, width=1200, height=800)`.
- `webview.start(boot, gui="edgechromium")` — `boot()` runs on pywebview's worker thread:
  1. `missing_prereqs()` → if any, `window.load_html(error_html("Lance install.bat d'abord…"))` and return.
  2. `ServerManager.start()`; wait for both-ready with a timeout (~120 s).
  3. On ready → `window.load_url(manager.frontend_url)`.
  4. On timeout/failure → `window.load_html(error_html(...))` with a Réessayer link (`pywebview` JS bridge calls back into `boot`).
- `window.events.closed += on_closed` → `ServerManager.stop()` then process exits.
- No pystray. The splash + window replace the tray status dot.

### 3. Splash (`SPLASH_HTML`, inline string in `launcher.py`)
Self-contained HTML (no server needed): dark background, the **book icon inlined
from `favicon.svg`**, app name, a CSS spinner, and a status line
("Démarrage… chargement des moteurs d'extraction, ~20–60 s au premier lancement").
An `#error` area is revealed by `error_html()` for failures.

### 4. `frontend/src/components/ModeChooser/ModeChooser.tsx` (+ `.css`) (new)
Full-screen overlay rendered above the app on load.
- Two large cards: **Standard** (extraction rapide, sans IA) and **Mode IA**
  (Florence-2 / Texify, plus lent, plus riche) — copy mirrors what `setAppMode("ai")` enables.
- Last pick (from `localStorage["app-mode-last"]`) is visually preselected.
- Selecting a card: `await setAppMode(mode)` → update `appMode` state → persist
  `localStorage["app-mode-last"]` → close the overlay.
- Props: `{ current: "standard"|"ai"; onChoose: (m) => void; onClose?: () => void }`.

### 5. `App.tsx` integration
- New state `showModeChooser` (init `true` — shown every launch).
- Existing `getAppMode()` mount effect stays; also read `localStorage["app-mode-last"]` for preselection.
- Render `<ModeChooser>` when `showModeChooser`; `onChoose` calls `setAppMode`, sets state, persists, hides the overlay.
- The existing top-bar Standard/IA toggle is unchanged (switch anytime later).

### 6. Icon pipeline
- `assets/app.ico` is a **one-time, committed** multi-size icon (16/32/48/64/128/256 px). The
  runtime never rasterizes at startup — it just references the committed `.ico`.
- `make_icon.py` (new) generates it. **Preferred:** rasterize the real `favicon.svg`
  (e.g. `cairosvg`/Inkscape at authoring time) → PNGs → `.ico` for exact fidelity.
  **Fallback** (if no rasterizer available on the authoring machine): redraw the book in
  Pillow using the `favicon.svg` palette (bg `#0f1117`, pages `#e8edf8`, spine `#ff8c00`,
  highlight `#ff8c00@22%`). Either way the output is committed; no runtime dependency.
- `favicon.svg` remains the web/browser source of truth (already shipped). The splash inlines it.

### 7. WebView2 runtime (bundled)
- `assets/MicrosoftEdgeWebview2Setup.exe` (Evergreen bootstrapper, ~2 MB, MS redistributable) committed.
- On launcher start: detect the runtime via registry
  (`HKLM`/`HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` `pv`).
  If absent → run the bootstrapper `/silent /install`, wait, re-check. If still
  absent → `ctypes` MessageBox with manual download link, then exit.

### 8. `build.bat` + packaging
- PyInstaller flags: `--windowed --icon assets\app.ico`, `--add-data` for
  `assets\MicrosoftEdgeWebview2Setup.exe` and any splash asset, plus pywebview's
  PyInstaller hooks (bundles the EdgeChromium loader). Entry point `launcher.py`.
- `launcher.bat` simplified (still launches `pythonw launcher.py` for the non-frozen path).

### 9. Dependencies
- Add `pywebview` to the launcher's requirements (wherever pystray/Pillow/psutil are declared; `install.bat`).
- `pystray` no longer imported by `launcher.py` (window-only). Leave installed or drop from requirements — plan decides.

## Data flow

```
double-click launcher.exe
  └─ launcher.py: ensure WebView2 (install bootstrapper if missing)
       └─ create window (SPLASH_HTML) ──> webview.start(boot, gui=edgechromium)
            └─ boot() [worker thread]:
                 missing_prereqs? ──yes──> window.load_html(error)        [stop]
                 ServerManager.start() (pick ports, write .env.local, spawn uvicorn+npm)
                 wait both-ready (≤120s) ──timeout──> window.load_html(error+retry)
                 ready ──> window.load_url(http://127.0.0.1:{fp})
                              └─ React app mounts
                                   └─ getAppMode() + last-mode preselect
                                   └─ <ModeChooser> overlay (every launch)
                                        └─ pick ──> setAppMode(mode) ──> enter app
window close ──> ServerManager.stop() (psutil tree-kill) ──> exit
```

## Error handling
| Failure | Surfaced as |
|---------|-------------|
| `.venv` / `node_modules` missing | Splash → "Installe d'abord : lance `install.bat`." |
| No free port | Splash → "Aucun port libre (8000–8888 / 5442–5446)." |
| Startup timeout (≥120 s) | Splash → message + **Réessayer** (re-runs `boot`) / fermer |
| WebView2 missing & install fails | `ctypes` MessageBox + download URL, then exit |
| Subprocess dies after ready | Window stays on last page; closing quits and cleans up |

## Testing strategy
- **`launcher_core.py`** — pytest in `tests/launcher/test_launcher_core.py` (repo-root `tests/`
  with a tiny conftest adding the root to `sys.path`, run via the backend venv's pytest):
  `classify_ready_line` (backend/frontend/none cases), `pick_port` (picks first free / `None` when all busy, monkeypatched socket), `write_env_local` (exact file contents), `missing_prereqs` (tmp dir with/without markers). ~5 tests.
- **`ModeChooser`** — `npx tsc --noEmit` + manual: overlay appears, preselect correct, pick calls `setAppMode` and dismisses, toggle still works.
- **Manual E2E** (the GUI/pywebview parts can't be unit-tested): double-click → splash → app loads → chooser → pick Standard then IA → close window → confirm `python`/`node` processes are gone in Task Manager. Repeat with `.venv` renamed to confirm the prereq error path, and (if feasible) on a machine without WebView2 to confirm the bootstrapper path.

## File structure
```
launcher.py                    (rewritten — pywebview shell + splash + WebView2 gate)
launcher_core.py               (new — ServerManager + pure helpers, testable)
make_icon.py                   (new — favicon book → assets/app.ico)
assets/app.ico                 (new — committed icon)
assets/MicrosoftEdgeWebview2Setup.exe  (new — bundled MS redistributable)
build.bat                      (updated — --windowed --icon, add-data, pywebview hooks)
launcher.bat                   (minor — unchanged behavior)
frontend/src/components/ModeChooser/ModeChooser.tsx   (new)
frontend/src/components/ModeChooser/ModeChooser.css   (new)
frontend/src/App.tsx           (integrate ModeChooser; show every launch; preselect last)
backend/requirements.txt | install.bat   (add pywebview)
tests/launcher/test_launcher_core.py      (new — pure-logic tests)
memory/* , GEMINI.md           (PROTOCOLE ÉCRITURE: LOG, phases D1, ROADMAP D1, decisions ADR, INDEX)
```

## Out of scope
- True standalone packaging (bundling Python/Node so no `.venv`/`node_modules` needed) — not requested.
- Minimize-to-tray / background running — rejected (window-only).
- Cross-platform (macOS/Linux) launcher — Windows only, as today.

## Risks
- **WebView2 dependency** is mitigated by bundling the bootstrapper; first run on a fresh machine will trigger a Microsoft install (network needed once).
- **PyInstaller + pywebview** bundling can be fiddly; the plan must verify the frozen `.exe` actually opens a window (a manual smoke step).
- **`.exe` size** grows (pywebview + bootstrapper); acceptable for a personal tool.
