"""
Launcher script for LUXA by Alf Studio (SNI 6389:2020).
Starts FastAPI backend (http://127.0.0.1:8000, which also serves frontend/dist)
and, when Node.js is available, starts the Vite dev server (http://127.0.0.1:5173).
"""

from __future__ import annotations

import glob
import os
import shutil
import subprocess
import sys
import time
from typing import Optional

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")

PYTHON_EXE = os.path.join(BACKEND_DIR, ".venv", "Scripts", "python.exe")
if not os.path.isfile(PYTHON_EXE):
    PYTHON_EXE = sys.executable
VITE_JS = os.path.join(FRONTEND_DIR, "node_modules", "vite", "bin", "vite.js")


def find_node_executable() -> Optional[str]:
    """Locate Node.js via NODE_EXE, PATH (`shutil.which`), or common Windows paths."""
    env_node = os.environ.get("NODE_EXE", "").strip()
    if env_node:
        if os.path.isfile(env_node):
            return env_node
        resolved = shutil.which(env_node)
        if resolved:
            return resolved

    in_path = shutil.which("node")
    if in_path:
        return in_path

    candidates = []
    for base_env in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        base = os.environ.get(base_env)
        if base:
            candidates.append(os.path.join(base, "nodejs", "node.exe"))
            candidates.append(os.path.join(base, "Programs", "nodejs", "node.exe"))

    nvm_symlink = os.environ.get("NVM_SYMLINK")
    if nvm_symlink:
        candidates.append(os.path.join(nvm_symlink, "node.exe"))

    appdata = os.environ.get("APPDATA")
    if appdata:
        nvm_hits = sorted(glob.glob(os.path.join(appdata, "nvm", "*", "node.exe")), reverse=True)
        candidates.extend(nvm_hits)

    for cand in candidates:
        if os.path.isfile(cand):
            return cand
    return None


def main() -> None:
    print("============================================================================", flush=True)
    print("  LUXA by Alf Studio (SNI 6389:2020)", flush=True)
    print("  Server & Aplikasi : http://127.0.0.1:8000", flush=True)

    backend_proc = subprocess.Popen(
        [PYTHON_EXE, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=BACKEND_DIR,
    )

    frontend_proc = None
    node_exe = find_node_executable()
    if node_exe and os.path.isfile(VITE_JS):
        print(f"  Mode Dev (Vite)   : http://127.0.0.1:5173  (Node: {node_exe})", flush=True)
        print("============================================================================", flush=True)
        frontend_proc = subprocess.Popen(
            [node_exe, VITE_JS, "--host", "127.0.0.1", "--port", "5173"],
            cwd=FRONTEND_DIR,
        )
    else:
        print("============================================================================", flush=True)
        print(
            "  [Info] Node.js tidak ditemukan di PATH maupun folder standar "
            "(%ProgramFiles%\\nodejs, %APPDATA%\\nvm).",
            flush=True,
        )
        print(
            "  Server LUXA tetap berjalan dan dapat dibuka langsung di http://127.0.0.1:8000",
            flush=True,
        )
        print(
            "  Untuk mode pengembangan Vite (:5173), pasang Node.js LTS dari https://nodejs.org/ "
            "atau atur variabel lingkungan NODE_EXE.",
            flush=True,
        )

    try:
        while True:
            time.sleep(1.0)
            if backend_proc.poll() is not None:
                print(f"Backend LUXA berhenti dengan kode {backend_proc.returncode}", flush=True)
                break
            if frontend_proc is not None and frontend_proc.poll() is not None:
                print(
                    f"Frontend Vite berhenti dengan kode {frontend_proc.returncode}. "
                    "Backend LUXA tetap berjalan di http://127.0.0.1:8000",
                    flush=True,
                )
                frontend_proc = None
    except KeyboardInterrupt:
        pass
    finally:
        for p in (frontend_proc, backend_proc):
            if p is not None and p.poll() is None:
                p.terminate()


if __name__ == "__main__":
    main()
