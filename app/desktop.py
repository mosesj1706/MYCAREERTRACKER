"""Run Career OS as a desktop app: start the Streamlit server, show it in a native
window, and stop the server when the window closes.

    python -m app.desktop
"""
import atexit
import socket
import subprocess
import sys
import time
import webbrowser

from app.core.config import ROOT

PORT = 8765
URL = f"http://127.0.0.1:{PORT}"
LOG = ROOT / "data" / "server.log"


def port_open() -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def start_server() -> subprocess.Popen | None:
    if port_open():  # already running (e.g. from ./run.sh)
        return None
    proc = subprocess.Popen(
        [sys.executable, "-m", "streamlit", "run", str(ROOT / "app" / "ui" / "dashboard.py"),
         "--server.headless", "true", "--server.port", str(PORT),
         "--browser.gatherUsageStats", "false"],
        cwd=ROOT, stdout=open(LOG, "w"), stderr=subprocess.STDOUT,
        env={"PYTHONPATH": str(ROOT), "PATH": "/usr/bin:/bin", "HOME": str(ROOT.home())},
    )
    atexit.register(proc.terminate)
    for _ in range(100):
        if port_open():
            return proc
        if proc.poll() is not None:
            raise RuntimeError(f"Streamlit exited early - see {LOG}")
        time.sleep(0.2)
    raise RuntimeError(f"Streamlit did not start within 20s - see {LOG}")


def main() -> None:
    start_server()
    try:
        import webview
    except ImportError:
        webbrowser.open(URL)
        input("Server running - press Enter to stop.")
        return
    webview.create_window("Career OS", URL, width=1400, height=900, min_size=(900, 600))
    webview.start()  # blocks until the window is closed; atexit then stops the server


if __name__ == "__main__":
    main()
