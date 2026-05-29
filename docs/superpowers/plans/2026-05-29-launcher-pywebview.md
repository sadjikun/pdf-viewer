# Friendly Launcher (pywebview) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the systray launcher with a pywebview desktop window that auto-starts the servers behind a splash, loads the web UI (which greets the user with a Standard/Mode-IA chooser), uses the app's book icon, and quits when the window closes.

**Architecture:** Split the launcher into a GUI-free, unit-tested `launcher_core.py` (server lifecycle + WebView2 detection) and a thin `launcher.py` pywebview shell (splash → boot → load app → close=quit). Add a frontend `ModeChooser` overlay wired to the existing `/app-mode` endpoint.

**Tech Stack:** Python (pywebview, psutil, stdlib), PyInstaller, React 19 + TypeScript, FastAPI (existing `/app-mode`).

> **Spec:** `docs/superpowers/specs/2026-05-29-launcher-pywebview-design.md`.
> **Conventions for EVERY commit:** use `rtk` (NEVER raw git); from project root `cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer"`; stage explicit files (NEVER `git add .` — untracked junk present); end every commit message with the trailer:
> `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`
> Backend venv python: `backend/.venv/Scripts/python.exe`. Frontend typecheck: `cd frontend && npx tsc --noEmit`.

---

## Data-Safety / behavior invariants (never violate)
- **I-1 Clean shutdown:** closing the window MUST kill both subprocesses (psutil tree-kill) — no orphan `python`/`node`.
- **I-2 No silent failure:** every start failure (missing prereqs, no port, timeout, missing WebView2) MUST be shown to the user (splash error or MessageBox).
- **I-3 Runtime is asset-free at start:** the launcher references a committed `assets/app.ico`; it never rasterizes SVG at runtime.
- **I-4 Mode is runtime-switchable:** the chooser calls `POST /app-mode` after servers are up; the top-bar toggle keeps working.

## File Structure
| File | Responsibility |
|------|----------------|
| `launcher_core.py` (new) | GUI-free: `pick_port`, `classify_ready_line`, `env_local_contents`, `write_env_local`, `missing_prereqs`, `webview2_installed`, `ensure_webview2`, `ServerManager` |
| `tests/launcher/conftest.py` (new) | add repo root to `sys.path` |
| `tests/launcher/test_launcher_core.py` (new) | pytest for the pure helpers |
| `launcher.py` (rewrite) | pywebview shell: splash, boot thread, load app, close=quit |
| `make_icon.py` (new) | favicon book → `assets/app.ico` (one-time) |
| `assets/app.ico` (new, committed) | multi-size icon for `.exe`/taskbar/window |
| `assets/MicrosoftEdgeWebview2Setup.exe` (new, committed) | bundled Evergreen bootstrapper |
| `build.bat` (modify) | PyInstaller flags: `--icon`, pywebview collect, add-data, drop tray imports |
| `install.bat` (modify) | `pip install pywebview` |
| `frontend/src/components/ModeChooser/ModeChooser.tsx` (new) | startup mode overlay |
| `frontend/src/components/ModeChooser/ModeChooser.css` (new) | overlay styling |
| `frontend/src/App.tsx` (modify) | mount ModeChooser, preselect last, `setAppMode` |
| `memory/*`, `GEMINI.md` (modify) | PROTOCOLE ÉCRITURE |

---

## Task 1: `launcher_core.py` pure helpers + tests

**Files:**
- Create: `launcher_core.py`
- Create: `tests/launcher/conftest.py`
- Test: `tests/launcher/test_launcher_core.py`

- [ ] **Step 1: conftest adds repo root to sys.path**

Create `tests/launcher/conftest.py`:
```python
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
```

- [ ] **Step 2: Write failing tests**

Create `tests/launcher/test_launcher_core.py`:
```python
import socket
from pathlib import Path

import launcher_core as core


def test_classify_ready_line_backend():
    assert core.classify_ready_line("backend", "INFO: Application startup complete.") is True
    assert core.classify_ready_line("backend", "INFO: Started reloader") is False


def test_classify_ready_line_frontend():
    assert core.classify_ready_line("frontend", "  VITE ready in 412 ms") is True
    assert core.classify_ready_line("frontend", "  ➜  Local:   http://127.0.0.1:5442/") is True
    assert core.classify_ready_line("frontend", "some other log") is False


def test_classify_ready_line_unknown_label():
    assert core.classify_ready_line("other", "Application startup complete") is False


def test_env_local_contents():
    assert core.env_local_contents(8001) == "VITE_API_BASE=http://127.0.0.1:8001\n"


def test_pick_port_returns_first_free(monkeypatch):
    busy = {8000}

    class FakeSock:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def bind(self, addr):
            if addr[1] in busy:
                raise OSError("in use")

    monkeypatch.setattr(core.socket, "socket", lambda *a, **k: FakeSock())
    assert core.pick_port([8000, 8001]) == 8001


def test_pick_port_none_when_all_busy(monkeypatch):
    class FakeSock:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def bind(self, addr): raise OSError("in use")

    monkeypatch.setattr(core.socket, "socket", lambda *a, **k: FakeSock())
    assert core.pick_port([8000, 8001]) is None


def test_missing_prereqs(tmp_path: Path):
    # empty root → both missing
    miss = core.missing_prereqs(tmp_path)
    assert len(miss) == 2
    # create both markers → none missing
    (tmp_path / "backend" / ".venv" / "Scripts").mkdir(parents=True)
    (tmp_path / "backend" / ".venv" / "Scripts" / "python.exe").write_text("x")
    (tmp_path / "frontend" / "node_modules").mkdir(parents=True)
    assert core.missing_prereqs(tmp_path) == []
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && backend/.venv/Scripts/python.exe -m pytest tests/launcher -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'launcher_core'`.

- [ ] **Step 4: Implement the pure helpers**

Create `launcher_core.py`:
```python
"""Server lifecycle + environment checks for the PDF Viewer launcher.
GUI-free so it can be unit-tested. The pywebview shell lives in launcher.py.
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

_CREATE_NO_WINDOW = 0x08000000
BACKEND_PORTS = [8000, 8001, 8002, 8003, 8080, 8888]
FRONTEND_PORTS = [5442, 5443, 5444, 5445, 5446]
WEBVIEW2_CLIENT_KEY = (
    r"SOFTWARE\Microsoft\EdgeUpdate\Clients"
    r"\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
)


def pick_port(candidates: list[int]) -> int | None:
    for port in candidates:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    return None


def classify_ready_line(label: str, line: str) -> bool:
    if label == "backend":
        return "Application startup complete" in line
    if label == "frontend":
        return ("ready in" in line) or ("Local:" in line)
    return False


def env_local_contents(backend_port: int) -> str:
    return f"VITE_API_BASE=http://127.0.0.1:{backend_port}\n"


def write_env_local(root: Path, backend_port: int) -> None:
    (root / "frontend" / ".env.local").write_text(
        env_local_contents(backend_port), encoding="utf-8"
    )


def missing_prereqs(root: Path) -> list[str]:
    missing: list[str] = []
    if not (root / "backend" / ".venv" / "Scripts" / "python.exe").exists():
        missing.append("backend/.venv (lance install.bat)")
    if not (root / "frontend" / "node_modules").exists():
        missing.append("frontend/node_modules (lance install.bat)")
    return missing
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && backend/.venv/Scripts/python.exe -m pytest tests/launcher -v`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && rtk git add launcher_core.py tests/launcher/conftest.py tests/launcher/test_launcher_core.py && rtk git commit -m "$(cat <<'EOF'
feat(launcher): GUI-free launcher_core helpers + tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: WebView2 detection + `ensure_webview2`

**Files:**
- Modify: `launcher_core.py`
- Test: `tests/launcher/test_launcher_core.py`

- [ ] **Step 1: Add failing tests**

Append to `tests/launcher/test_launcher_core.py`:
```python
def test_webview2_installed_true(monkeypatch):
    import launcher_core as c

    class FakeKey:
        def __enter__(self): return self
        def __exit__(self, *a): return False

    class FakeWinreg:
        HKEY_LOCAL_MACHINE = 0
        HKEY_CURRENT_USER = 1
        def OpenKey(self, hive, key): return FakeKey()
        def QueryValueEx(self, k, name): return ("119.0.0.1", 1)

    monkeypatch.setitem(__import__("sys").modules, "winreg", FakeWinreg())
    assert c.webview2_installed() is True


def test_webview2_installed_false(monkeypatch):
    import launcher_core as c

    class FakeWinreg:
        HKEY_LOCAL_MACHINE = 0
        HKEY_CURRENT_USER = 1
        def OpenKey(self, hive, key): raise OSError("absent")
        def QueryValueEx(self, k, name): raise OSError("absent")

    monkeypatch.setitem(__import__("sys").modules, "winreg", FakeWinreg())
    assert c.webview2_installed() is False
```

- [ ] **Step 2: Run — expect failure** (`AttributeError: module 'launcher_core' has no attribute 'webview2_installed'`)

Run: `cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && backend/.venv/Scripts/python.exe -m pytest tests/launcher -v`

- [ ] **Step 3: Implement**

Append to `launcher_core.py`:
```python
def webview2_installed() -> bool:
    """True if the WebView2 Evergreen runtime is registered (HKLM or HKCU)."""
    try:
        import winreg
    except ImportError:
        return True  # non-Windows: nothing to install
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            with winreg.OpenKey(hive, WEBVIEW2_CLIENT_KEY) as k:
                pv, _ = winreg.QueryValueEx(k, "pv")
                if pv and pv != "0.0.0.0":
                    return True
        except OSError:
            continue
    return False


def ensure_webview2(assets_dir: Path) -> bool:
    """Install the bundled Evergreen bootstrapper if the runtime is missing.
    Returns True if WebView2 is available afterwards."""
    if webview2_installed():
        return True
    boot = assets_dir / "MicrosoftEdgeWebview2Setup.exe"
    if not boot.exists():
        return False
    try:
        subprocess.run([str(boot), "/silent", "/install"], check=False)
    except Exception:
        return False
    return webview2_installed()
```

- [ ] **Step 4: Run — expect pass** (9 tests)

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && rtk git add launcher_core.py tests/launcher/test_launcher_core.py && rtk git commit -m "$(cat <<'EOF'
feat(launcher): WebView2 runtime detection + bootstrapper install

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `ServerManager` (start/stop/readiness)

**Files:**
- Modify: `launcher_core.py`
- Test: `tests/launcher/test_launcher_core.py`

- [ ] **Step 1: Add a failing test (prereq guard, no subprocess)**

Append to `tests/launcher/test_launcher_core.py`:
```python
def test_server_manager_start_fails_without_prereqs(tmp_path):
    import launcher_core as c
    errs = []
    mgr = c.ServerManager(tmp_path)
    mgr.on_error = errs.append
    assert mgr.start() is False
    assert errs and "Prérequis" in errs[0]


def test_server_manager_frontend_url_none_before_start(tmp_path):
    import launcher_core as c
    assert c.ServerManager(tmp_path).frontend_url is None
```

- [ ] **Step 2: Run — expect failure** (`AttributeError: ... 'ServerManager'`)

- [ ] **Step 3: Implement `ServerManager`**

Append to `launcher_core.py`:
```python
class ServerManager:
    """Spawns + supervises the uvicorn and Vite dev processes."""

    def __init__(self, root: Path):
        self.root = root
        self._backend: subprocess.Popen | None = None
        self._frontend: subprocess.Popen | None = None
        self.backend_port: int | None = None
        self.frontend_port: int | None = None
        self._backend_ready = False
        self._frontend_ready = False
        self._lock = threading.Lock()
        self.on_ready = None   # callable()
        self.on_error = None   # callable(str)

    @property
    def frontend_url(self) -> str | None:
        return (
            f"http://127.0.0.1:{self.frontend_port}"
            if self.frontend_port else None
        )

    def _emit_error(self, msg: str) -> None:
        if self.on_error:
            try:
                self.on_error(msg)
            except Exception:
                pass

    def _watch(self, proc: subprocess.Popen, label: str) -> None:
        try:
            for raw in proc.stdout:  # type: ignore[union-attr]
                line = raw.rstrip()
                if not line or not classify_ready_line(label, line):
                    continue
                with self._lock:
                    if label == "backend":
                        self._backend_ready = True
                    else:
                        self._frontend_ready = True
                    both = self._backend_ready and self._frontend_ready
                if both and self.on_ready:
                    try:
                        self.on_ready()
                    except Exception:
                        pass
        except Exception:
            pass

    def start(self) -> bool:
        miss = missing_prereqs(self.root)
        if miss:
            self._emit_error("Prérequis manquants : " + " ; ".join(miss))
            return False
        bp = pick_port(BACKEND_PORTS)
        fp = pick_port(FRONTEND_PORTS)
        if bp is None or fp is None:
            self._emit_error("Aucun port libre (8000–8888 / 5442–5446).")
            return False
        self.backend_port, self.frontend_port = bp, fp
        write_env_local(self.root, bp)

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
        venv_py = self.root / "backend" / ".venv" / "Scripts" / "python.exe"

        self._backend = subprocess.Popen(
            [str(venv_py), "-m", "uvicorn", "main:app", "--reload",
             "--reload-exclude", ".venv", "--port", str(bp)],
            cwd=self.root / "backend", env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
            creationflags=_CREATE_NO_WINDOW,
        )
        npm = "npm.cmd" if sys.platform == "win32" else "npm"
        self._frontend = subprocess.Popen(
            [npm, "run", "dev", "--", "--port", str(fp), "--host", "127.0.0.1"],
            cwd=self.root / "frontend", env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
            creationflags=_CREATE_NO_WINDOW,
        )
        threading.Thread(target=self._watch, args=(self._backend, "backend"),
                         daemon=True).start()
        threading.Thread(target=self._watch, args=(self._frontend, "frontend"),
                         daemon=True).start()
        return True

    def stop(self) -> None:
        try:
            import psutil
            have_psutil = True
        except ImportError:
            have_psutil = False
        for proc in (self._backend, self._frontend):
            if proc is None:
                continue
            try:
                if have_psutil:
                    parent = psutil.Process(proc.pid)
                    for k in parent.children(recursive=True):
                        try: k.terminate()
                        except Exception: pass
                    parent.terminate()
                    time.sleep(0.3)
                    for k in parent.children(recursive=True):
                        try: k.kill()
                        except Exception: pass
                    try: parent.kill()
                    except Exception: pass
                else:
                    proc.terminate()
                    try: proc.wait(timeout=3)
                    except subprocess.TimeoutExpired: proc.kill()
            except Exception:
                pass
        self._backend = None
        self._frontend = None
```

- [ ] **Step 4: Run — expect pass** (11 tests)

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && rtk git add launcher_core.py tests/launcher/test_launcher_core.py && rtk git commit -m "$(cat <<'EOF'
feat(launcher): ServerManager process supervision in launcher_core

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: App icon (`make_icon.py` → `assets/app.ico`)

**Files:**
- Create: `make_icon.py`
- Create (generated, committed): `assets/app.ico`

- [ ] **Step 1: Write `make_icon.py`**

Create `make_icon.py`:
```python
"""Generate assets/app.ico from the book favicon. Run once; commit the .ico.
Prefers rasterizing frontend/public/favicon.svg (exact). Falls back to a Pillow
re-draw using the same palette if no SVG rasterizer is installed.
"""
from pathlib import Path

ROOT = Path(__file__).parent
SVG = ROOT / "frontend" / "public" / "favicon.svg"
OUT = ROOT / "assets" / "app.ico"
SIZES = [16, 32, 48, 64, 128, 256]


def _from_svg() -> bool:
    try:
        import cairosvg  # type: ignore
        from PIL import Image
        import io
    except Exception:
        return False
    pngs = []
    for s in SIZES:
        data = cairosvg.svg2png(url=str(SVG), output_width=s, output_height=s)
        pngs.append(Image.open(io.BytesIO(data)).convert("RGBA"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    pngs[-1].save(OUT, sizes=[(s, s) for s in SIZES])
    return True


def _from_pillow() -> None:
    from PIL import Image, ImageDraw
    base = 256
    img = Image.new("RGBA", (base, base), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = base / 48.0  # favicon is a 48px viewBox
    def S(*v): return [x * k for x in v]
    d.rounded_rectangle(S(0, 0, 48, 48), radius=10 * k, fill="#0f1117")
    # left + right pages
    d.polygon(S(22, 9, 18, 10, 12, 11, 8, 13, 8, 37, 12, 35, 18, 35.5, 22, 37), fill="#e8edf8")
    d.polygon(S(26, 9, 30, 10, 36, 11, 40, 13, 40, 37, 36, 35, 30, 35.5, 26, 37), fill="#e8edf8")
    # spine
    d.rounded_rectangle(S(21.5, 9, 26.5, 37), radius=2.5 * k, fill="#ff8c00")
    # highlighted line (reading)
    d.rounded_rectangle(S(10, 14.5, 20, 18), radius=1.75 * k, fill="#ffd9a0")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, sizes=[(s, s) for s in SIZES])


if __name__ == "__main__":
    if not _from_svg():
        _from_pillow()
    print(f"Wrote {OUT}")
```

- [ ] **Step 2: Generate the icon**

Run: `cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && backend/.venv/Scripts/python.exe make_icon.py`
Expected: prints `Wrote ...assets/app.ico` and the file exists.

- [ ] **Step 3: Verify it opens**

Run: `cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && backend/.venv/Scripts/python.exe -c "from PIL import Image; im=Image.open('assets/app.ico'); print(im.size)"`
Expected: prints a size tuple (no exception).

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && rtk git add make_icon.py assets/app.ico && rtk git commit -m "$(cat <<'EOF'
feat(launcher): app.ico generated from book favicon

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Bundle the WebView2 bootstrapper

**Files:**
- Add (committed binary): `assets/MicrosoftEdgeWebview2Setup.exe`

- [ ] **Step 1: Download the Evergreen bootstrapper**

Download Microsoft's official Evergreen Standalone Bootstrapper to `assets/MicrosoftEdgeWebview2Setup.exe`:
Run: `cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && backend/.venv/Scripts/python.exe -c "import urllib.request,pathlib; pathlib.Path('assets').mkdir(exist_ok=True); urllib.request.urlretrieve('https://go.microsoft.com/fwlink/p/?LinkId=2124703','assets/MicrosoftEdgeWebview2Setup.exe'); print('ok')"`
Expected: prints `ok`; file is ~1–2 MB.

- [ ] **Step 2: Sanity check it's an executable**

Run: `cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && backend/.venv/Scripts/python.exe -c "d=open('assets/MicrosoftEdgeWebview2Setup.exe','rb').read(2); print(d==b'MZ')"`
Expected: prints `True` (valid PE header).

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && rtk git add assets/MicrosoftEdgeWebview2Setup.exe && rtk git commit -m "$(cat <<'EOF'
chore(launcher): bundle WebView2 Evergreen bootstrapper

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

> If `.gitignore` excludes `*.exe`, force-add: `rtk proxy git add -f assets/MicrosoftEdgeWebview2Setup.exe` (and likewise for `assets/app.ico` if `.ico` is ignored). The committed binary is required for offline first-run.

---

## Task 6: Rewrite `launcher.py` (pywebview shell)

**Files:**
- Modify (rewrite): `launcher.py`

- [ ] **Step 1: Install pywebview into the venv (needed to run/test the shell)**

Run: `cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && backend/.venv/Scripts/python.exe -m pip install pywebview`
Expected: installs `pywebview` (+ its Windows deps).

- [ ] **Step 2: Replace the entire contents of `launcher.py`**

```python
"""PDF Viewer — fenêtre de bureau (pywebview).
Double-clic → splash → démarre backend+frontend → charge l'app.
Fermer la fenêtre quitte l'application (et arrête les serveurs).
"""
import sys
import threading
import time
from pathlib import Path

if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).parent
else:
    ROOT = Path(__file__).parent
ASSETS = ROOT / "assets"

import launcher_core as core


def _msgbox(text: str, title: str = "PDF Viewer") -> None:
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, text, title, 0x10)
    except Exception:
        pass


# Book favicon inlined (kept in sync with frontend/public/favicon.svg).
_BOOK_SVG = """
<svg class="book" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="48" height="48" rx="10" fill="#0f1117"/>
  <ellipse cx="24" cy="41" rx="13" ry="2.5" fill="#000" opacity="0.35"/>
  <path d="M22 9 C18 10 12 11 8 13 L8 37 C12 35 18 35.5 22 37 Z" fill="#e8edf8"/>
  <path d="M26 9 C30 10 36 11 40 13 L40 37 C36 35 30 35.5 26 37 Z" fill="#e8edf8"/>
  <rect x="21.5" y="9" width="5" height="28" rx="2.5" fill="#ff8c00"/>
  <rect x="10" y="14.5" width="10" height="3.5" rx="1.75" fill="#ff8c00" opacity="0.22"/>
  <rect x="10.5" y="15.5" width="9" height="1.5" rx="0.75" fill="#ff8c00" opacity="0.9"/>
  <path d="M38 14.5 L41 17 L38 19.5 Z" fill="#ff8c00" opacity="0.85"/>
</svg>
"""

_SPLASH_CSS = """
html,body{height:100%;margin:0;background:#0f1117;color:#e8edf8;
font-family:system-ui,Segoe UI,sans-serif;display:flex;flex-direction:column;
align-items:center;justify-content:center;gap:18px}
.book{width:96px;height:96px}
.spin{width:34px;height:34px;border:3px solid #2a2f3a;border-top-color:#ff8c00;
border-radius:50%;animation:r .9s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}
.msg{font-size:16px;opacity:.9}
.sub{font-size:12px;opacity:.5;max-width:440px;text-align:center;line-height:1.5}
#err{color:#ff8c00;font-size:14px;max-width:480px;text-align:center;white-space:pre-wrap}
"""


def _page(title: str, spinner: bool, error: str = "") -> str:
    spin = '<div class="spin"></div>' if spinner else ""
    err = f'<div id="err">{error}</div>' if error else ""
    return (
        f"<!doctype html><html><head><meta charset='utf-8'>"
        f"<style>{_SPLASH_CSS}</style></head><body>{_BOOK_SVG}"
        f"<div class='msg'>{title}</div>"
        f"<div class='sub'>Chargement des moteurs d'extraction. "
        f"Le premier lancement peut prendre 20–60 s.</div>{spin}{err}</body></html>"
    )


SPLASH_HTML = _page("Démarrage de PDF Viewer…", spinner=True)


def error_html(message: str) -> str:
    safe = message.replace("&", "&amp;").replace("<", "&lt;")
    return _page("Impossible de démarrer", spinner=False, error=safe)


def main() -> None:
    import webview

    if not core.ensure_webview2(ASSETS):
        _msgbox(
            "Le composant Microsoft WebView2 est requis et n'a pas pu être installé.\n\n"
            "Installez-le manuellement :\n"
            "https://developer.microsoft.com/microsoft-edge/webview2/"
        )
        return

    window = webview.create_window("PDF Viewer", html=SPLASH_HTML,
                                   width=1280, height=860)
    mgr = core.ServerManager(ROOT)

    def boot() -> None:
        done = {"ok": False}

        def on_ready():
            done["ok"] = True
            window.load_url(mgr.frontend_url)

        def on_error(msg):
            window.load_html(error_html(msg))

        mgr.on_ready = on_ready
        mgr.on_error = on_error
        if not mgr.start():
            return  # on_error already rendered
        for _ in range(120):           # ~120 s watchdog
            if done["ok"]:
                return
            time.sleep(1)
        if not done["ok"]:
            window.load_html(error_html(
                "Délai dépassé au démarrage (120 s).\n"
                "Ferme la fenêtre et réessaie."
            ))

    def on_closed() -> None:
        threading.Thread(target=mgr.stop, daemon=True).start()

    window.events.closed += on_closed
    webview.start(boot, gui="edgechromium")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Smoke-run the launcher (manual)**

Run: `cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && backend/.venv/Scripts/python.exe launcher.py`
Expected: a window opens showing the book splash + spinner; after the servers boot it navigates to the app; closing the window ends the process. Confirm in Task Manager that `python`/`node` are gone after closing.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && rtk git add launcher.py && rtk git commit -m "$(cat <<'EOF'
feat(launcher): pywebview window shell with splash + close-to-quit

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Frontend `ModeChooser` component

**Files:**
- Create: `frontend/src/components/ModeChooser/ModeChooser.tsx`
- Create: `frontend/src/components/ModeChooser/ModeChooser.css`

- [ ] **Step 1: Create the component**

`frontend/src/components/ModeChooser/ModeChooser.tsx`:
```tsx
import "./ModeChooser.css";

interface Props {
  current: "standard" | "ai";
  onChoose: (mode: "standard" | "ai") => void;
}

export function ModeChooser({ current, onChoose }: Props) {
  return (
    <div className="mode-chooser" role="dialog" aria-modal="true"
         aria-label="Choix du mode de lancement">
      <div className="mode-chooser__panel">
        <h1 className="mode-chooser__title">Comment veux-tu lancer&nbsp;?</h1>
        <p className="mode-chooser__sub">
          Tu pourras changer à tout moment depuis la barre du haut.
        </p>
        <div className="mode-chooser__cards">
          <button
            type="button"
            className={`mode-card${current === "standard" ? " is-preselected" : ""}`}
            onClick={() => onChoose("standard")}
            autoFocus={current === "standard"}
          >
            <span className="mode-card__icon">⚡</span>
            <span className="mode-card__name">Standard</span>
            <span className="mode-card__desc">
              Extraction rapide, sans IA. Idéal pour lire et annoter vite.
            </span>
          </button>
          <button
            type="button"
            className={`mode-card mode-card--ai${current === "ai" ? " is-preselected" : ""}`}
            onClick={() => onChoose("ai")}
            autoFocus={current === "ai"}
          >
            <span className="mode-card__icon">🤖</span>
            <span className="mode-card__name">Mode IA</span>
            <span className="mode-card__desc">
              Florence-2 (légendes de figures) + Texify (formules). Plus riche, plus lent.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the CSS**

`frontend/src/components/ModeChooser/ModeChooser.css`:
```css
.mode-chooser {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(10, 11, 16, 0.78); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; padding: 1.5rem;
}
.mode-chooser__panel {
  background: var(--bg2, #12131a); color: var(--tx, #f3f4f6);
  border: 1px solid var(--bd, rgba(255,255,255,.08));
  border-radius: 16px; padding: 2rem; max-width: 720px; width: 100%;
  box-shadow: 0 24px 64px rgba(0,0,0,.5);
}
.mode-chooser__title { margin: 0 0 .25rem; font-size: 1.5rem; }
.mode-chooser__sub { margin: 0 0 1.5rem; opacity: .65; font-size: .95rem; }
.mode-chooser__cards { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
@media (max-width: 560px) { .mode-chooser__cards { grid-template-columns: 1fr; } }
.mode-card {
  display: flex; flex-direction: column; gap: .5rem; text-align: left;
  padding: 1.25rem; border-radius: 12px; cursor: pointer;
  background: var(--bg3, #181a24); color: inherit;
  border: 2px solid var(--bd, rgba(255,255,255,.1)); transition: all .15s ease;
}
.mode-card:hover { border-color: #ff8c00; transform: translateY(-2px); }
.mode-card.is-preselected { border-color: #ff8c00; box-shadow: 0 0 0 3px rgba(255,140,0,.25); }
.mode-card__icon { font-size: 2rem; }
.mode-card__name { font-size: 1.15rem; font-weight: 700; }
.mode-card__desc { font-size: .85rem; opacity: .7; line-height: 1.4; }
```

- [ ] **Step 3: Type-check**

Run: `cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer/frontend" && npx tsc --noEmit`
Expected: no errors. (Component is imported in Task 8; tsc may warn it's unused only if `noUnusedLocals` — it isn't here, and Task 8 wires it.)

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && rtk git add frontend/src/components/ModeChooser/ModeChooser.tsx frontend/src/components/ModeChooser/ModeChooser.css && rtk git commit -m "$(cat <<'EOF'
feat(frontend): ModeChooser startup overlay component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire `ModeChooser` into `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx` (import; state at ~90; mount effect ~196; handler ~200-205; render at ~583-584)

- [ ] **Step 1: Add the import**

After the existing component imports near the top of `App.tsx`, add:
```tsx
import { ModeChooser } from "./components/ModeChooser/ModeChooser";
```

- [ ] **Step 2: Preselect last mode + add overlay state**

Change the `appMode` state initializer (currently `useState<"standard" | "ai">("standard")` at ~line 90) to read the remembered pick, and add an overlay flag right after it:
```tsx
  const [appMode, setAppModeState] = useState<"standard" | "ai">(
    () => (localStorage.getItem("app-mode-last") as "standard" | "ai") || "standard",
  );
  const [showModeChooser, setShowModeChooser] = useState(true);
```

- [ ] **Step 3: Add the choose handler**

Immediately after the existing `handleAppModeToggle` (ends ~line 205), add:
```tsx
  const handleChooseMode = async (mode: "standard" | "ai") => {
    await handleAppModeToggle(mode);
    localStorage.setItem("app-mode-last", mode);
    setShowModeChooser(false);
  };
```

- [ ] **Step 4: Render the overlay**

Immediately after the top-level `return (` opening `<div className={...app...}>` (line 583-584), insert the overlay as the first child:
```tsx
      {showModeChooser && (
        <ModeChooser current={appMode} onChoose={handleChooseMode} />
      )}
```

- [ ] **Step 5: Type-check**

Run: `cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer/frontend" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual smoke**

`npm run dev`, open the app: the chooser overlay appears on load with the last mode preselected; clicking a card calls `setAppMode`, dismisses the overlay, and the top-bar toggle reflects the choice and still switches modes.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && rtk git add frontend/src/App.tsx && rtk git commit -m "$(cat <<'EOF'
feat(frontend): show ModeChooser on launch, preselect last mode

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Update `build.bat` + `install.bat`

**Files:**
- Modify: `build.bat`
- Modify: `install.bat`

- [ ] **Step 1: Add pywebview to `install.bat`**

Open `install.bat`, find the line(s) that `pip install` the launcher deps (pystray/Pillow/psutil). Add `pywebview` to that install command. If there is a dedicated line, change e.g.:
```bat
pip install pystray Pillow psutil
```
to:
```bat
pip install pywebview Pillow psutil
```
(Keep `Pillow` — used by `make_icon.py`. `pystray` is no longer needed; drop it.)
If you cannot find such a line, add a new one after the venv is activated:
```bat
pip install pywebview Pillow psutil --quiet
```

- [ ] **Step 2: Replace the PyInstaller block + closing banner in `build.bat`**

Replace the `pyinstaller ^ ... launcher.py` invocation (currently lines ~30-44) with:
```bat
pyinstaller ^
  --onefile ^
  --windowed ^
  --name launcher ^
  --icon assets\app.ico ^
  --distpath . ^
  --workpath build\_pyinstaller ^
  --specpath build ^
  --collect-all webview ^
  --hidden-import=psutil ^
  --hidden-import=PIL._imaging ^
  --add-data "assets\app.ico;assets" ^
  --add-data "assets\MicrosoftEdgeWebview2Setup.exe;assets" ^
  --add-data "launcher_core.py;." ^
  launcher.py
```
Then replace the closing banner text (currently lines ~58-64, the "Clic droit … Standard ou Mode IA" box) with:
```bat
echo  +----------------------------------------------+
echo  ^|  [OK] launcher.exe cree dans ce dossier !   ^|
echo  ^|                                              ^|
echo  ^|  Double-clic : fenetre de l'application.     ^|
echo  ^|  Choix Standard / Mode IA dans la fenetre.   ^|
echo  +----------------------------------------------+
```

- [ ] **Step 3: Build the exe (manual verification)**

Run: `cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && build.bat`
Expected: `launcher.exe` is regenerated with the book icon. Double-click it: splash window → app → chooser. If PyInstaller misses a pywebview/edgechromium module at runtime, add the missing `--hidden-import` / `--collect-all` and rebuild (note any additions in the commit message).

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && rtk git add build.bat install.bat && rtk git commit -m "$(cat <<'EOF'
build(launcher): package pywebview + icon + WebView2 bootstrapper

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

> Do NOT commit the regenerated `launcher.exe` unless the user asks — it is large and currently untracked.

---

## Task 10: Memory wiki updates (PROTOCOLE ÉCRITURE)

**Files:**
- Modify: `memory/LOG.md`, `memory/phases.md`, `memory/ROADMAP.md`, `memory/decisions.md`, `memory/INDEX.md`

- [ ] **Step 1: `memory/LOG.md`** — add a dated entry (2026-05-29) at the top of the entries summarizing: systray launcher replaced by a pywebview window (window-only, close=quit), startup ModeChooser, bundled WebView2, app.ico from the book favicon, `launcher_core.py` extracted + tested.

- [ ] **Step 2: `memory/decisions.md`** — add an ADR (next number after the last existing) "Launcher = pywebview window (window-only) + bundled WebView2", recording: chosen over tray/browser for an app-like UX (ROADMAP D1); window-only because pywebview and pystray fight over the main GUI loop; WebView2 bundled for first-run on fresh machines; still requires `.venv`/`node_modules` (not standalone).

- [ ] **Step 3: `memory/phases.md`** — under "Phase 3 — Diffusion" (or add it), mark **D1 launcher pywebview** as ✅ Fait (2026-05-29). Update the "Dernière MAJ" line to 2026-05-29.

- [ ] **Step 4: `memory/ROADMAP.md`** — in the Phase 3 table, mark **D1** done (e.g. `| D1 ✅ | ...`); in the Suivi table, update `Phase 3 — Diffusion` from `🔄 en cours (launcher pywebview)` to note the launcher is done.

- [ ] **Step 5: `memory/INDEX.md`** — bump the "Mis à jour" date to 2026-05-29 (add a row only if a new memory page was created — none here).

- [ ] **Step 6: Run the full test suite (regression gate)**

Run: `cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && backend/.venv/Scripts/python.exe -m pytest backend/tests tests/launcher -q`
Expected: all green (existing backend tests + the new launcher_core tests).

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/MHDINGBI/Desktop/PDF-VIEWER/pdf-viewer" && rtk git add memory/LOG.md memory/phases.md memory/ROADMAP.md memory/decisions.md memory/INDEX.md && rtk git commit -m "$(cat <<'EOF'
docs(memory): record pywebview launcher (D1) + ModeChooser

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (run before execution)

- **Spec coverage:** pywebview window + splash (Tasks 3,6) ✓; close=quit/I-1 (Task 6 `on_closed`→`stop`) ✓; WebView2 bundle+install (Tasks 2,5,6) ✓; ModeChooser every-launch + preselect (Tasks 7,8) ✓; `setAppMode` wiring/I-4 (Task 8 reuses `handleAppModeToggle`) ✓; icon from favicon → exe/window (Tasks 4,9) ✓; testable core (Tasks 1-3) ✓; no-silent-failure/I-2 (Task 6 error_html + msgbox) ✓; asset-free runtime/I-3 (Task 4 committed .ico) ✓.
- **Placeholder scan:** none — every code step is complete; the only "find the line" steps (install.bat, build.bat, App.tsx) give exact before/after and line anchors.
- **Type/identifier consistency:** `ServerManager`, `pick_port`, `classify_ready_line`, `env_local_contents`, `missing_prereqs`, `webview2_installed`, `ensure_webview2`, `frontend_url`, `on_ready`, `on_error` consistent across Tasks 1-3 and used in Task 6. Frontend: `ModeChooser` props `{current,onChoose}` match the Task 8 call; `handleAppModeToggle` reused; `app-mode-last` localStorage key consistent (Tasks 8). `assets/app.ico` + `assets/MicrosoftEdgeWebview2Setup.exe` paths consistent across Tasks 4,5,6,9.

---

## Execution Handoff
After all tasks: dispatch a final reviewer for the whole change, then use superpowers:finishing-a-development-branch. The GUI window itself is verified manually (Tasks 6 Step 3, 8 Step 6, 9 Step 3); `launcher_core` is covered by pytest.
