"""Uji A3-10: peringatan build basi di backend/run_studio_servers.py."""

from __future__ import annotations

import os
import sys

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from run_studio_servers import check_stale_build, warn_if_build_stale  # noqa: E402


def _make_fake_repo(tmp_path, dist_mtime: float | None, src_mtime: float, py_mtime: float) -> str:
    root = tmp_path / "repo"
    (root / "frontend" / "src").mkdir(parents=True)
    (root / "backend" / "loaders").mkdir(parents=True)

    src_file = root / "frontend" / "src" / "main.js"
    src_file.write_text("console.log('hi');\n", encoding="utf-8")
    os.utime(src_file, (src_mtime, src_mtime))

    py_file = root / "backend" / "ottv_engine.py"
    py_file.write_text("# engine\n", encoding="utf-8")
    os.utime(py_file, (py_mtime, py_mtime))

    if dist_mtime is not None:
        (root / "frontend" / "dist").mkdir(parents=True)
        dist_index = root / "frontend" / "dist" / "index.html"
        dist_index.write_text("<html></html>\n", encoding="utf-8")
        os.utime(dist_index, (dist_mtime, dist_mtime))

    return str(root)


def test_build_mutakhir_tanpa_peringatan(tmp_path, capsys):
    repo = _make_fake_repo(tmp_path, dist_mtime=2000.0, src_mtime=1000.0, py_mtime=1500.0)
    is_stale, rel = check_stale_build(repo)
    assert is_stale is False
    assert rel == ""
    assert warn_if_build_stale(repo) is False
    assert capsys.readouterr().out == ""


def test_frontend_src_lebih_baru_cetak_peringatan(tmp_path, capsys):
    repo = _make_fake_repo(tmp_path, dist_mtime=2000.0, src_mtime=2100.0, py_mtime=1500.0)
    is_stale, rel = check_stale_build(repo)
    assert is_stale is True
    assert rel == "frontend/src/main.js"
    assert warn_if_build_stale(repo) is True
    out = capsys.readouterr().out
    assert "Build aplikasi lebih lama dari kode" in out
    assert "cd frontend && npm run build" in out
    assert "Node.js 20 LTS" in out


def test_backend_py_lebih_baru_cetak_peringatan(tmp_path, capsys):
    repo = _make_fake_repo(tmp_path, dist_mtime=2000.0, src_mtime=1000.0, py_mtime=2050.0)
    is_stale, rel = check_stale_build(repo)
    assert is_stale is True
    assert rel == "backend/ottv_engine.py"
    assert warn_if_build_stale(repo) is True
    out = capsys.readouterr().out
    assert "Build aplikasi lebih lama dari kode" in out
    assert "Node.js 20 LTS" in out


def test_dist_belum_ada_cetak_peringatan(tmp_path, capsys):
    repo = _make_fake_repo(tmp_path, dist_mtime=None, src_mtime=1000.0, py_mtime=1000.0)
    is_stale, rel = check_stale_build(repo)
    assert is_stale is True
    assert rel == ""
    assert warn_if_build_stale(repo) is True
    out = capsys.readouterr().out
    assert "frontend/dist/index.html" in out
    assert "cd frontend && npm run build" in out
    assert "Node.js 20 LTS" in out
