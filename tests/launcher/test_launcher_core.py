import sys
from pathlib import Path

import launcher_core as core


# ── pure helpers ────────────────────────────────────────────────────────────

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
    miss = core.missing_prereqs(tmp_path)
    assert len(miss) == 2
    (tmp_path / "backend" / ".venv" / "Scripts").mkdir(parents=True)
    (tmp_path / "backend" / ".venv" / "Scripts" / "python.exe").write_text("x")
    (tmp_path / "frontend" / "node_modules").mkdir(parents=True)
    assert core.missing_prereqs(tmp_path) == []


# ── WebView2 detection ───────────────────────────────────────────────────────

def test_webview2_installed_true(monkeypatch):
    class FakeKey:
        def __enter__(self): return self
        def __exit__(self, *a): return False

    class FakeWinreg:
        HKEY_LOCAL_MACHINE = 0
        HKEY_CURRENT_USER = 1
        def OpenKey(self, hive, key): return FakeKey()
        def QueryValueEx(self, k, name): return ("119.0.0.1", 1)

    monkeypatch.setitem(sys.modules, "winreg", FakeWinreg())
    assert core.webview2_installed() is True


def test_webview2_installed_via_wow6432node(monkeypatch):
    wow = core.WEBVIEW2_CLIENT_KEYS[1]  # the WOW6432Node path

    class FakeKey:
        def __enter__(self): return self
        def __exit__(self, *a): return False

    class FakeWinreg:
        HKEY_LOCAL_MACHINE = 0
        HKEY_CURRENT_USER = 1
        def OpenKey(self, hive, key):
            if key == wow:
                return FakeKey()
            raise OSError("absent at native path")
        def QueryValueEx(self, k, name): return ("119.0.0.1", 1)

    monkeypatch.setitem(sys.modules, "winreg", FakeWinreg())
    assert core.webview2_installed() is True


def test_webview2_installed_false(monkeypatch):
    class FakeWinreg:
        HKEY_LOCAL_MACHINE = 0
        HKEY_CURRENT_USER = 1
        def OpenKey(self, hive, key): raise OSError("absent")
        def QueryValueEx(self, k, name): raise OSError("absent")

    monkeypatch.setitem(sys.modules, "winreg", FakeWinreg())
    assert core.webview2_installed() is False


# ── ServerManager ────────────────────────────────────────────────────────────

def test_server_manager_start_fails_without_prereqs(tmp_path):
    errs = []
    mgr = core.ServerManager(tmp_path)
    mgr.on_error = errs.append
    assert mgr.start() is False
    assert errs and "Prérequis" in errs[0]


def test_server_manager_frontend_url_none_before_start(tmp_path):
    assert core.ServerManager(tmp_path).frontend_url is None
