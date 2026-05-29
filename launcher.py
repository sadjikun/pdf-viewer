"""PDF Viewer — fenêtre de bureau (pywebview).
Double-clic → splash → démarre backend+frontend → charge l'app.
Fermer la fenêtre quitte l'application (et arrête les serveurs).
"""
import sys
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

    # Best-effort: only run the bundled installer if our probe says WebView2 is
    # missing. Do NOT hard-gate on it — the probe can false-negative (e.g. a
    # per-machine install under WOW6432Node) and the runtime may be present
    # anyway. We try to launch regardless and only error if the window can't open.
    if not core.webview2_installed():
        core.ensure_webview2(ASSETS)

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

    # webview.start() blocks until the window is closed, then returns. Stop the
    # servers SYNCHRONOUSLY (finally) — a daemon thread on the 'closed' event
    # races process exit and can orphan uvicorn/node (invariant I-1).
    try:
        webview.start(boot, gui="edgechromium")
    except Exception as exc:
        _msgbox(
            "Impossible d'ouvrir la fenêtre — le composant Microsoft WebView2 "
            "semble manquant ou inutilisable.\n\n"
            f"Détail : {exc}\n\n"
            "Installez-le : https://developer.microsoft.com/microsoft-edge/webview2/"
        )
    finally:
        mgr.stop()


if __name__ == "__main__":
    main()
