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
                        try:
                            k.terminate()
                        except Exception:
                            pass
                    parent.terminate()
                    time.sleep(0.3)
                    for k in parent.children(recursive=True):
                        try:
                            k.kill()
                        except Exception:
                            pass
                    try:
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
        self._backend = None
        self._frontend = None
