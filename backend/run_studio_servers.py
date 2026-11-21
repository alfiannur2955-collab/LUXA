"""
Launcher script for OTTV 3D Parametric Studio v3.0 (5-Stage Universal Gatekeeper Architecture).
Starts both the FastAPI backend (http://127.0.0.1:8000) and Vite frontend (http://127.0.0.1:5173).
"""

import os
import subprocess
import sys
import time

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")

PYTHON_EXE = os.path.join(BACKEND_DIR, ".venv", "Scripts", "python.exe")
NODE_EXE = r"E:\APPS\ARCHICAD\ARCHICAD 30\node.exe"
VITE_JS = os.path.join(FRONTEND_DIR, "node_modules", "vite", "bin", "vite.js")


def main() -> None:
    print("Starting OTTV 3D Parametric Studio v3.0 (Backend :8000 + Frontend :5173)...", flush=True)
    backend_proc = subprocess.Popen(
        [PYTHON_EXE, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=BACKEND_DIR,
    )
    frontend_proc = subprocess.Popen(
        [NODE_EXE, VITE_JS, "--host", "127.0.0.1", "--port", "5173"],
        cwd=FRONTEND_DIR,
    )
    try:
        while True:
            time.sleep(1.0)
            if backend_proc.poll() is not None:
                print(f"Backend exited with code {backend_proc.returncode}", flush=True)
                break
            if frontend_proc.poll() is not None:
                print(f"Frontend exited with code {frontend_proc.returncode}", flush=True)
                break
    except KeyboardInterrupt:
        pass
    finally:
        for p in (backend_proc, frontend_proc):
            if p.poll() is None:
                p.terminate()


if __name__ == "__main__":
    main()
