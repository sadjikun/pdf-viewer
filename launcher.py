"""
PDF Viewer — Launcher systray.
Icône dans la barre des tâches Windows.
Clic droit : Démarrer Standard / Mode IA / Ouvrir / Arrêter / Quitter.
"""

import collections
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

# PyInstaller : trouver le dossier racine du projet depuis le .exe compilé
if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).parent
else:
    ROOT = Path(__file__).parent

_CREATE_NO_WINDOW = 0x08000000

try:
    import pystray
    from PIL import Image, ImageDraw
except ImportError:
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            0,
            "Dépendances manquantes (pystray / Pillow).\n\nRelancez install.bat puis launcher.bat.",
            "PDF Viewer — Erreur",
            0x10,
        )
    except Exception:
        pass
    sys.exit(1)


# ── Icône générée par code ──────────────────────────────────────────────────

def _make_icon(state: str) -> Image.Image:
    """
    Icône 64×64 : silhouette de document PDF + dot de statut coloré.
    state : 'stopped' | 'starting' | 'ready'
    """
    dot_colors = {"stopped": "#6b7280", "starting": "#f59e0b", "ready": "#22c55e"}
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Fond arrondi sombre
    d.rounded_rectangle([1, 1, size - 2, size - 2], radius=14, fill="#1a1a3e")
    # Corps du document (coin plié en haut à droite)
    d.polygon([(12, 8), (38, 8), (38, 20), (50, 20), (50, 54), (12, 54)], fill="#3730a3")
    d.polygon([(38, 8), (50, 20), (38, 20)], fill="#6366f1")
    # Lignes de texte
    for y_offset in [27, 33, 39]:
        d.rectangle([16, y_offset, 36, y_offset + 3], fill="#818cf8")
    d.rectangle([16, 45, 28, 48], fill="#6366f1")
    # Dot de statut (bas-droite)
    color = dot_colors.get(state, "#6b7280")
    d.ellipse([37, 37, 61, 61], fill="#0f0f23")   # halo sombre
    d.ellipse([40, 40, 59, 59], fill=color)
    return img


# ── Backend API ─────────────────────────────────────────────────────────────

class LauncherAPI:
    def __init__(self):
        self._backend_proc = None
        self._frontend_proc = None
        self._backend_port: int | None = None
        self._frontend_port: int | None = None
        self._backend_status = "stopped"    # stopped | starting | ready
        self._frontend_status = "stopped"
        self._lock = threading.Lock()
        self.on_state_change = None         # callable mis à jour par main()

    # ── Helpers ──────────────────────────────────────────────────────────

    def _find_free_port(self, candidates: list) -> int | None:
        for port in candidates:
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.bind(("127.0.0.1", port))
                    return port
            except OSError:
                continue
        return None

    def _notify(self):
        if self.on_state_change:
            try:
                self.on_state_change()
            except Exception:
                pass

    def _read_output(self, proc, label: str):
        try:
            for raw in proc.stdout:
                line = raw.rstrip()
                if not line:
                    continue
                changed = False
                with self._lock:
                    if label == "backend" and "Application startup complete" in line:
                        if self._backend_status != "ready":
                            self._backend_status = "ready"
                            changed = True
                    elif label == "frontend" and (
                        "ready in" in line or "Local:" in line
                    ):
                        if self._frontend_status != "ready":
                            self._frontend_status = "ready"
                            changed = True
                if changed:
                    self._notify()
        except Exception:
            pass

    # ── État ─────────────────────────────────────────────────────────────

    def is_stopped(self) -> bool:
        with self._lock:
            return (
                self._backend_status == "stopped"
                and self._frontend_status == "stopped"
            )

    def is_starting(self) -> bool:
        with self._lock:
            return (
                self._backend_status == "starting"
                or self._frontend_status == "starting"
            )

    def is_running(self) -> bool:
        with self._lock:
            return (
                self._backend_status == "ready"
                and self._frontend_status == "ready"
            )

    def get_url(self) -> str | None:
        with self._lock:
            if (
                self._backend_status == "ready"
                and self._frontend_status == "ready"
            ):
                return f"http://127.0.0.1:{self._frontend_port}"
        return None

    # ── Actions ───────────────────────────────────────────────────────────

    def start(self, mode: str) -> bool:
        venv_python = ROOT / "backend" / ".venv" / "Scripts" / "python.exe"
        if not venv_python.exists() or not (ROOT / "frontend" / "node_modules").exists():
            return False

        bp = self._find_free_port([8000, 8001, 8002, 8003, 8080, 8888])
        fp = self._find_free_port([5442, 5443, 5444, 5445, 5446])
        if bp is None or fp is None:
            return False

        (ROOT / "frontend" / ".env.local").write_text(
            f"VITE_API_BASE=http://127.0.0.1:{bp}\n", encoding="utf-8"
        )

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

        with self._lock:
            self._backend_status = "starting"
            self._frontend_status = "starting"
            self._backend_port = bp
            self._frontend_port = fp

        self._notify()

        self._backend_proc = subprocess.Popen(
            [
                str(venv_python), "-m", "uvicorn", "main:app",
                "--reload", "--reload-exclude", ".venv",
                "--port", str(bp),
            ],
            cwd=ROOT / "backend",
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=_CREATE_NO_WINDOW,
        )

        npm = "npm.cmd" if sys.platform == "win32" else "npm"
        self._frontend_proc = subprocess.Popen(
            [npm, "run", "dev", "--", "--port", str(fp), "--host", "127.0.0.1"],
            cwd=ROOT / "frontend",
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=_CREATE_NO_WINDOW,
        )

        threading.Thread(
            target=self._read_output, args=(self._backend_proc, "backend"), daemon=True
        ).start()
        threading.Thread(
            target=self._read_output, args=(self._frontend_proc, "frontend"), daemon=True
        ).start()
        return True

    def stop(self):
        try:
            import psutil
            _psutil = True
        except ImportError:
            _psutil = False

        for proc in [self._backend_proc, self._frontend_proc]:
            if proc is None:
                continue
            try:
                if _psutil:
                    parent = psutil.Process(proc.pid)
                    kids = parent.children(recursive=True)
                    for k in kids:
                        try:
                            k.terminate()
                        except Exception:
                            pass
                    parent.terminate()
                    time.sleep(0.3)
                    for k in kids:
                        try:
                            if k.is_running():
                                k.kill()
                        except Exception:
                            pass
                    try:
                        if parent.is_running():
                            parent.kill()
                    except Exception:
                        pass
                else:
                    proc.terminate()
                    try:
                        proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        proc.kill()
            except Exception:
                pass

        with self._lock:
            self._backend_proc = None
            self._frontend_proc = None
            self._backend_port = None
            self._frontend_port = None
            self._backend_status = "stopped"
            self._frontend_status = "stopped"

        self._notify()


# ── Systray ──────────────────────────────────────────────────────────────────

def main():
    api = LauncherAPI()

    # Fabrique de callbacks pour éviter le piège de la closure en boucle
    def _make_start(mode: str):
        def action(icon, item):
            threading.Thread(target=api.start, args=(mode,), daemon=True).start()
        return action

    def _open(icon, item):
        url = api.get_url()
        if url:
            webbrowser.open(url)

    def _stop(icon, item):
        threading.Thread(target=api.stop, daemon=True).start()

    def _quit(icon, item):
        api.stop()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem(
            "  Démarrer",
            _make_start("standard"),
            visible=lambda item: api.is_stopped(),
        ),
        pystray.MenuItem(
            "  Démarrage en cours…",
            None,
            enabled=False,
            visible=lambda item: api.is_starting(),
        ),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(
            "  Ouvrir l'application",
            _open,
            default=True,
            visible=lambda item: api.is_running(),
        ),
        pystray.MenuItem(
            "  Arrêter",
            _stop,
            visible=lambda item: api.is_running(),
        ),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quitter", _quit),
    )

    icon = pystray.Icon("pdf-viewer", _make_icon("stopped"), "PDF Viewer", menu)

    def on_state_change():
        if api.is_running():
            state, title = "ready", "PDF Viewer  —  En ligne"
        elif api.is_starting():
            state, title = "starting", "PDF Viewer  —  Démarrage…"
        else:
            state, title = "stopped", "PDF Viewer"
        icon.icon = _make_icon(state)
        icon.title = title
        icon.update_menu()

    api.on_state_change = on_state_change
    icon.run()


if __name__ == "__main__":
    main()
