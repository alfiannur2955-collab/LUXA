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
from typing import Optional, Tuple

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")

PYTHON_EXE = os.path.join(BACKEND_DIR, ".venv", "Scripts", "python.exe")
if not os.path.isfile(PYTHON_EXE):
    PYTHON_EXE = sys.executable
VITE_JS = os.path.join(FRONTEND_DIR, "node_modules", "vite", "bin", "vite.js")

_SKIP_BACKEND_DIRS = frozenset({".venv", "__pycache__", "uploads", "samples", "epw_samples"})
_SKIP_BACKEND_FILES = frozenset({"run_studio_servers.py"})


def check_stale_build(project_root: str = PROJECT_ROOT) -> Tuple[bool, str]:
    """Bandingkan waktu ubah terbaru di frontend/src/ dan backend/**/*.py dengan frontend/dist/index.html.

    Mengembalikan `(is_stale, detail_rel_path)` di mana `detail_rel_path` adalah path relatif file sumber
    terbaru (atau `""` jika `frontend/dist/index.html` belum ada / masih mutakhir).
    """
    dist_index = os.path.join(project_root, "frontend", "dist", "index.html")
    if not os.path.isfile(dist_index):
        return True, ""

    dist_mtime = os.path.getmtime(dist_index)
    newest_mtime = 0.0
    newest_path = ""

    src_dir = os.path.join(project_root, "frontend", "src")
    if os.path.isdir(src_dir):
        for root, dirs, files in os.walk(src_dir):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            for fn in files:
                fp = os.path.join(root, fn)
                try:
                    mt = os.path.getmtime(fp)
                except OSError:
                    continue
                if mt > newest_mtime:
                    newest_mtime = mt
                    newest_path = fp

    backend_dir = os.path.join(project_root, "backend")
    if os.path.isdir(backend_dir):
        for root, dirs, files in os.walk(backend_dir):
            dirs[:] = [d for d in dirs if d not in _SKIP_BACKEND_DIRS]
            for fn in files:
                if not fn.endswith(".py") or fn in _SKIP_BACKEND_FILES:
                    continue
                fp = os.path.join(root, fn)
                try:
                    mt = os.path.getmtime(fp)
                except OSError:
                    continue
                if mt > newest_mtime:
                    newest_mtime = mt
                    newest_path = fp

    if newest_mtime > dist_mtime + 1.0:
        rel = os.path.relpath(newest_path, project_root).replace("\\", "/")
        return True, rel
    return False, ""


def warn_if_build_stale(project_root: str = PROJECT_ROOT) -> bool:
    """Cetak peringatan jelas di konsol bila frontend/dist belum ada atau lebih lama dari kode sumber."""
    is_stale, newest_rel = check_stale_build(project_root)
    if not is_stale:
        return False

    print("============================================================================", flush=True)
    if newest_rel:
        print("  [PERINGATAN] Build aplikasi lebih lama dari kode.", flush=True)
        print(f"  File sumber lebih baru: {newest_rel}", flush=True)
    else:
        print("  [PERINGATAN] Build aplikasi (frontend/dist/index.html) belum ditemukan.", flush=True)
    print("  Jalankan: cd frontend && npm run build", flush=True)
    print("  (Diperlukan Node.js 20 LTS — unduh dari https://nodejs.org/)", flush=True)
    print("============================================================================", flush=True)
    return True


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

    warn_if_build_stale(PROJECT_ROOT)

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
