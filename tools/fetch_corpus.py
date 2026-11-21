"""
OTTV 3D Parametric Studio — Pengunduh Korpus Tingkat B (`tools/fetch_corpus.py`)
================================================================================
Mengunduh korpus model BIM/3D publik (Tingkat B) ke folder `corpus/` (yang sudah
di-.gitignore) sesuai `docs/FASE1C_SPEC.md` §4:
  1. Schependomlaan (openBIMstandards/DataSetSchependomlaan) — ArchiCAD IFC
  2. Duplex Apartment IFC 2x3 (wbdg.org/node/9165) — Revit -> IFC
  3. buildingSMART/Certification-datasets — hanya file bangunan utuh
  4. BIMvoice/ifcsamples — 3 arketipe kantor IFC 4.3 (cek SOURCE.md & lisensi)

Mencatat URL, lisensi, tanggal unduh, dan ukuran file di `corpus/SOURCES.md`.
Jika suatu unduhan gagal, dicatat di `corpus/SOURCES.md` dan proses tetap lanjut.
"""

from __future__ import annotations

import datetime
import io
import os
import re
import sys
import zipfile
from typing import Any, Dict, List, Optional, Tuple

import httpx

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CORPUS_DIR = os.path.join(ROOT_DIR, "corpus")
SOURCES_MD = os.path.join(CORPUS_DIR, "SOURCES.md")

HEADERS = {
    "User-Agent": "OTTV-3D-SNI6389-CorpusFetcher/1.0 (+academic-research)",
    "Accept": "application/vnd.github+json",
}

MAX_FILE_MB = 85.0  # Hindari arsip raksasa > 85 MB saat diunduh otomatis


def _fmt_size(n_bytes: int) -> str:
    if n_bytes >= 1024 * 1024:
        return f"{n_bytes / (1024 * 1024):.2f} MB"
    return f"{n_bytes / 1024:.1f} KB"


def _download_bytes(client: httpx.Client, url: str, timeout: float = 90.0) -> bytes:
    with client.stream("GET", url, follow_redirects=True, timeout=timeout) as resp:
        resp.raise_for_status()
        buf = bytearray()
        for chunk in resp.iter_bytes():
            buf.extend(chunk)
            if len(buf) > MAX_FILE_MB * 1024 * 1024:
                raise ValueError(f"Ukuran unduhan melebihi batas {MAX_FILE_MB:.0f} MB")
        return bytes(buf)


def _extract_ifc_from_zip(
    zip_bytes: bytes,
    dest_dir: str,
    prefer_keywords: Optional[Tuple[str, ...]] = None,
    max_files: int = 3,
) -> List[Tuple[str, int]]:
    os.makedirs(dest_dir, exist_ok=True)
    extracted: List[Tuple[str, int]] = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        ifc_infos = [
            info for info in zf.infolist()
            if (not info.is_dir()) and info.filename.lower().endswith(".ifc") and "__macosx" not in info.filename.lower()
        ]
        if prefer_keywords:
            def _score(info: zipfile.ZipInfo) -> Tuple[int, int]:
                lo = info.filename.lower()
                hit = 0 if any(k in lo for k in prefer_keywords) else 1
                return (hit, -info.file_size)
            ifc_infos.sort(key=_score)
        else:
            ifc_infos.sort(key=lambda i: -i.file_size)

        for info in ifc_infos[:max_files]:
            base = os.path.basename(info.filename)
            out_path = os.path.join(dest_dir, base)
            data = zf.read(info)
            with open(out_path, "wb") as f:
                f.write(data)
            extracted.append((out_path, len(data)))
    return extracted


def _github_repo_tree(client: httpx.Client, owner: str, repo: str) -> Tuple[str, List[Dict[str, Any]]]:
    r_info = client.get(f"https://api.github.com/repos/{owner}/{repo}", headers=HEADERS, timeout=30.0)
    r_info.raise_for_status()
    default_branch = r_info.json().get("default_branch", "main")
    r_tree = client.get(
        f"https://api.github.com/repos/{owner}/{repo}/git/trees/{default_branch}?recursive=1",
        headers=HEADERS,
        timeout=30.0,
    )
    r_tree.raise_for_status()
    return default_branch, r_tree.json().get("tree", [])


def fetch_schependomlaan(client: httpx.Client, records: List[Dict[str, Any]], today: str) -> None:
    """1. Schependomlaan (openBIMstandards/DataSetSchependomlaan -> Archive / IBPSA mirror)."""
    dest = os.path.join(CORPUS_DIR, "schependomlaan")
    os.makedirs(dest, exist_ok=True)
    repo_url = "https://github.com/openBIMstandards/DataSetSchependomlaan"
    lic = "Izin akademik / openBIMstandards (TU Eindhoven / Schependomlaan)"
    try:
        # Coba rilis/repo resmi DataSetSchependomlaan, Archive-DataSetSchependomlaan, lalu mirror IBPSA Project 1
        candidate_repos = [
            ("openBIMstandards", "DataSetSchependomlaan"),
            ("openBIMstandards", "Archive-DataSetSchependomlaan"),
        ]
        for owner, repo in candidate_repos:
            try:
                r_rel = client.get(f"https://api.github.com/repos/{owner}/{repo}/releases", headers=HEADERS, timeout=30.0)
                if r_rel.status_code == 200:
                    for rel in r_rel.json():
                        for asset in rel.get("assets", []):
                            if asset.get("name", "").lower().endswith(".zip"):
                                zip_url = asset["browser_download_url"]
                                data = _download_bytes(client, zip_url)
                                extracted = _extract_ifc_from_zip(data, dest, prefer_keywords=("schependomlaan", "design", "arch"), max_files=2)
                                if extracted:
                                    for path, sz in extracted:
                                        records.append({
                                            "source": "Schependomlaan",
                                            "local_path": os.path.relpath(path, ROOT_DIR).replace("\\", "/"),
                                            "url": zip_url,
                                            "license": lic,
                                            "date": today,
                                            "size": _fmt_size(sz),
                                            "status": "OK",
                                        })
                                    return
                branch, tree = _github_repo_tree(client, owner, repo)
                ifc_paths = [t["path"] for t in tree if t.get("type") == "blob" and t["path"].lower().endswith(".ifc")]
                ifc_paths.sort(key=lambda p: (0 if "design" in p.lower() or "schependomlaan" in p.lower() else 1, len(p)))
                if ifc_paths:
                    rel_p = ifc_paths[0]
                    raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{rel_p.replace(' ', '%20')}"
                    data = _download_bytes(client, raw_url)
                    out_path = os.path.join(dest, os.path.basename(rel_p))
                    with open(out_path, "wb") as f:
                        f.write(data)
                    records.append({
                        "source": "Schependomlaan",
                        "local_path": os.path.relpath(out_path, ROOT_DIR).replace("\\", "/"),
                        "url": raw_url,
                        "license": lic,
                        "date": today,
                        "size": _fmt_size(len(data)),
                        "status": "OK",
                    })
                    return
            except Exception:
                continue

        # Fallback: direct research mirror (IBPSA Project 1)
        direct_urls = [
            "https://raw.githubusercontent.com/ibpsa/project1-wp-2-2-bim/master/IFC_Files/MISC/Schependomlaan.ifc",
        ]
        last_err = None
        for url in direct_urls:
            try:
                data = _download_bytes(client, url, timeout=90.0)
                if b"ISO-10303-21" in data[:512]:
                    out_path = os.path.join(dest, "Schependomlaan.ifc")
                    with open(out_path, "wb") as f:
                        f.write(data)
                    records.append({
                        "source": "Schependomlaan",
                        "local_path": os.path.relpath(out_path, ROOT_DIR).replace("\\", "/"),
                        "url": url,
                        "license": lic,
                        "date": today,
                        "size": _fmt_size(len(data)),
                        "status": "OK",
                    })
                    return
            except Exception as exc:
                last_err = exc
        raise FileNotFoundError(f"Tidak ditemukan file .ifc Schependomlaan (terakhir: {last_err})")
    except Exception as e:
        records.append({
            "source": "Schependomlaan",
            "local_path": "-",
            "url": repo_url,
            "license": lic,
            "date": today,
            "size": "-",
            "status": f"GAGAL: {type(e).__name__}: {e}",
        })


def fetch_duplex_apartment(client: httpx.Client, records: List[Dict[str, Any]], today: str) -> None:
    """2. Duplex Apartment IFC 2x3 (WBDG node 9165, Revit -> IFC)."""
    dest = os.path.join(CORPUS_DIR, "duplex_apartment")
    os.makedirs(dest, exist_ok=True)
    page_url = "https://www.wbdg.org/node/9165"
    lic = "Public / buildingSMART Common BIM Files (WBDG / NIBS)"
    try:
        candidate_urls: List[str] = []
        try:
            r = client.get(page_url, headers={"User-Agent": HEADERS["User-Agent"]}, follow_redirects=True, timeout=30.0)
            if r.status_code == 200:
                links = re.findall(r'href=["\']([^"\']+(?:\.zip|\.ifc))["\']', r.text, flags=re.IGNORECASE)
                for lk in links:
                    lo = lk.lower()
                    if "duplex" in lo and ("ifc" in lo or "arch" in lo or "2x3" in lo or lo.endswith(".zip") or lo.endswith(".ifc")):
                        full = lk if lk.startswith("http") else f"https://www.wbdg.org{lk}"
                        candidate_urls.append(full)
                # Also prioritize any Duplex_A_20110907_optimized.ifc or IFC zip links
                for lk in links:
                    if "ifc" in lk.lower():
                        full = lk if lk.startswith("http") else f"https://www.wbdg.org{lk}"
                        if full not in candidate_urls:
                            candidate_urls.append(full)
        except Exception:
            pass

        # Known official WBDG / open-source mirror URLs for Duplex_A IFC 2x3
        candidate_urls.extend([
            "https://www.wbdg.org/files/pdfs/bims_duplex_ifc.zip",
            "https://raw.githubusercontent.com/andyward/XBimDemo/master/Xbim.TestApp/Duplex_A_20110907.ifc",
            "https://gitlab.com/petr.hradil/ac-co2-rd/-/raw/master/Duplex_A_20110907.ifc",
        ])

        last_err = None
        for url in candidate_urls:
            try:
                data = _download_bytes(client, url, timeout=60.0)
                if url.lower().endswith(".zip"):
                    extracted = _extract_ifc_from_zip(data, dest, prefer_keywords=("duplex_a", "arch", "duplex"), max_files=1)
                    if not extracted:
                        continue
                    for path, sz in extracted:
                        records.append({
                            "source": "Duplex Apartment IFC 2x3",
                            "local_path": os.path.relpath(path, ROOT_DIR).replace("\\", "/"),
                            "url": url,
                            "license": lic,
                            "date": today,
                            "size": _fmt_size(sz),
                            "status": "OK",
                        })
                    return
                elif b"ISO-10303-21" in data[:512]:
                    fname = os.path.basename(url.split("?")[0]).replace("%20", "_")
                    if not fname.lower().endswith(".ifc"):
                        fname = "Duplex_A_20110907.ifc"
                    out_path = os.path.join(dest, fname)
                    with open(out_path, "wb") as f:
                        f.write(data)
                    records.append({
                        "source": "Duplex Apartment IFC 2x3",
                        "local_path": os.path.relpath(out_path, ROOT_DIR).replace("\\", "/"),
                        "url": url,
                        "license": lic,
                        "date": today,
                        "size": _fmt_size(len(data)),
                        "status": "OK",
                    })
                    return
            except Exception as exc:
                last_err = exc
                continue
        raise RuntimeError(f"Semua URL kandidat gagal (terakhir: {last_err})")
    except Exception as e:
        records.append({
            "source": "Duplex Apartment IFC 2x3",
            "local_path": "-",
            "url": page_url,
            "license": lic,
            "date": today,
            "size": "-",
            "status": f"GAGAL: {type(e).__name__}: {e}",
        })


def fetch_buildingsmart_cert(client: httpx.Client, records: List[Dict[str, Any]], today: str) -> None:
    """3. buildingSMART/Certification-datasets — hanya model bangunan arsitektur utuh."""
    dest = os.path.join(CORPUS_DIR, "buildingsmart_cert")
    if os.path.isdir(dest):
        for fn in os.listdir(dest):
            if fn.lower().endswith(".ifc"):
                os.remove(os.path.join(dest, fn))
    os.makedirs(dest, exist_ok=True)
    repo_url = "https://github.com/buildingSMART/Certification-datasets"
    lic = "buildingSMART International (CC-BY / Certification Datasets)"
    try:
        branch, tree = _github_repo_tree(client, "buildingSMART", "Certification-datasets")
        ifc_blobs = [t for t in tree if t.get("type") == "blob" and t["path"].lower().endswith(".ifc")]

        # Pilih khusus file bangunan arsitektur utuh (`Building-Architecture.ifc` di tiap skema IFC)
        chosen = [b for b in ifc_blobs if "building-architecture.ifc" in b["path"].lower()]
        chosen.sort(key=lambda b: b["path"])

        if not chosen:
            raise FileNotFoundError(f"Tidak ada Building-Architecture.ifc ditemukan dari {len(ifc_blobs)} IFC di repo")

        for blob in chosen:
            rel_p = blob["path"]
            raw_url = f"https://raw.githubusercontent.com/buildingSMART/Certification-datasets/{branch}/{rel_p.replace(' ', '%20')}"
            if "2.3" in rel_p or "2x3" in rel_p.lower():
                tag = "IFC2x3"
            elif "4.3" in rel_p:
                tag = "IFC43"
            else:
                tag = "IFC4"
            out_path = os.path.join(dest, f"Building-Architecture_{tag}.ifc")
            try:
                data = _download_bytes(client, raw_url, timeout=60.0)
                with open(out_path, "wb") as f:
                    f.write(data)
                records.append({
                    "source": f"buildingSMART Certification-datasets ({tag})",
                    "local_path": os.path.relpath(out_path, ROOT_DIR).replace("\\", "/"),
                    "url": raw_url,
                    "license": lic,
                    "date": today,
                    "size": _fmt_size(len(data)),
                    "status": "OK",
                })
            except Exception as exc:
                records.append({
                    "source": f"buildingSMART Certification-datasets ({tag})",
                    "local_path": "-",
                    "url": raw_url,
                    "license": lic,
                    "date": today,
                    "size": "-",
                    "status": f"GAGAL: {type(exc).__name__}: {exc}",
                })
    except Exception as e:
        records.append({
            "source": "buildingSMART Certification-datasets",
            "local_path": "-",
            "url": repo_url,
            "license": lic,
            "date": today,
            "size": "-",
            "status": f"GAGAL: {type(e).__name__}: {e}",
        })


def fetch_bimvoice_ifcsamples(client: httpx.Client, records: List[Dict[str, Any]], today: str) -> None:
    """4. BIMvoice/ifcsamples — 3 arketipe kantor IFC 4.3; cek SOURCE.md tiap file."""
    dest = os.path.join(CORPUS_DIR, "bimvoice_ifc43")
    os.makedirs(dest, exist_ok=True)
    repo_url = "https://github.com/BIMvoice/ifcsamples"
    try:
        branch, tree = _github_repo_tree(client, "BIMvoice", "ifcsamples")
        ifc_blobs = [t for t in tree if t.get("type") == "blob" and t["path"].lower().endswith(".ifc")]
        source_mds = {
            os.path.dirname(t["path"]): t["path"]
            for t in tree
            if t.get("type") == "blob" and os.path.basename(t["path"]).lower() == "source.md"
        }

        # Cari file arketipe kantor / IFC 4.3
        office_blobs = [
            b for b in ifc_blobs
            if any(k in b["path"].lower() for k in ("office", "archetype", "4.3", "4x3", "ifc43", "ifc4_3", "kantor", "building"))
        ]
        if not office_blobs:
            office_blobs = ifc_blobs

        # Prioritaskan 3 arketipe kantor IFC 4.3 (ukuran <= 30 MB)
        office_blobs = [b for b in office_blobs if int(b.get("size", 0)) <= 30 * 1024 * 1024]
        office_blobs.sort(key=lambda b: (0 if "office" in b["path"].lower() else 1, 0 if "4" in b["path"].lower() else 1, b["path"]))

        downloaded = 0
        for blob in office_blobs:
            if downloaded >= 3:
                break
            rel_p = blob["path"]
            parent_dir = os.path.dirname(rel_p)
            src_md_path = source_mds.get(parent_dir) or source_mds.get(os.path.dirname(parent_dir))
            lic_note = "Lihat repo BIMvoice/ifcsamples"
            allow = True
            if src_md_path:
                md_url = f"https://raw.githubusercontent.com/BIMvoice/ifcsamples/{branch}/{src_md_path.replace(' ', '%20')}"
                try:
                    md_text = client.get(md_url, timeout=20.0).text
                    md_lo = md_text.lower()
                    # Ekstrak baris lisensi bila ada
                    m_lic = re.search(r"(?:licen[cs]e|izin|copyright)[^\n]*", md_text, flags=re.IGNORECASE)
                    if m_lic:
                        lic_note = m_lic.group(0).strip().replace("|", "/")[:120]
                    # Tolak bila eksplisit melarang distribusi/penggunaan
                    if any(blk in md_lo for blk in ("all rights reserved - no permission", "do not redistribute", "prohibited", "non-downloadable")):
                        allow = False
                except Exception:
                    pass
            if not allow:
                records.append({
                    "source": "BIMvoice ifcsamples",
                    "local_path": "-",
                    "url": f"https://github.com/BIMvoice/ifcsamples/blob/{branch}/{rel_p}",
                    "license": lic_note,
                    "date": today,
                    "size": "-",
                    "status": "DILEWATI (lisensi SOURCE.md tidak mengizinkan)",
                })
                continue

            raw_url = f"https://raw.githubusercontent.com/BIMvoice/ifcsamples/{branch}/{rel_p.replace(' ', '%20')}"
            out_path = os.path.join(dest, os.path.basename(rel_p))
            try:
                data = _download_bytes(client, raw_url, timeout=60.0)
                with open(out_path, "wb") as f:
                    f.write(data)
                downloaded += 1
                records.append({
                    "source": "BIMvoice ifcsamples (IFC 4.3)",
                    "local_path": os.path.relpath(out_path, ROOT_DIR).replace("\\", "/"),
                    "url": raw_url,
                    "license": lic_note,
                    "date": today,
                    "size": _fmt_size(len(data)),
                    "status": "OK",
                })
            except Exception as exc:
                records.append({
                    "source": "BIMvoice ifcsamples (IFC 4.3)",
                    "local_path": "-",
                    "url": raw_url,
                    "license": lic_note,
                    "date": today,
                    "size": "-",
                    "status": f"GAGAL: {type(exc).__name__}: {exc}",
                })
    except Exception as e:
        records.append({
            "source": "BIMvoice ifcsamples",
            "local_path": "-",
            "url": repo_url,
            "license": "-",
            "date": today,
            "size": "-",
            "status": f"GAGAL: {type(e).__name__}: {e}",
        })


def write_sources_md(records: List[Dict[str, Any]], today: str) -> None:
    os.makedirs(CORPUS_DIR, exist_ok=True)
    lines = [
        "# Sumber Korpus Tingkat B (Publik)",
        "",
        f"Tanggal unduh terakhir: `{today}`",
        "",
        "| Sumber | File Lokal | URL | Lisensi | Tanggal | Ukuran | Status |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in records:
        lines.append(
            f"| {r['source']} | `{r['local_path']}` | {r['url']} | {r['license']} | {r['date']} | {r['size']} | {r['status']} |"
        )
    lines.append("")
    lines.append("Catatan: Korpus Tingkat C berada di `corpus/real/` (diisi manual, tidak diunduh otomatis).")
    with open(SOURCES_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main() -> None:
    os.makedirs(CORPUS_DIR, exist_ok=True)
    today = datetime.date.today().isoformat()
    records: List[Dict[str, Any]] = []
    with httpx.Client(timeout=60.0) as client:
        print("[1/4] Mengunduh Schependomlaan...")
        fetch_schependomlaan(client, records, today)
        print("[2/4] Mengunduh Duplex Apartment IFC 2x3...")
        fetch_duplex_apartment(client, records, today)
        print("[3/4] Mengunduh buildingSMART Certification-datasets (bangunan utuh)...")
        fetch_buildingsmart_cert(client, records, today)
        print("[4/4] Mengunduh BIMvoice ifcsamples (arketipe kantor IFC 4.3)...")
        fetch_bimvoice_ifcsamples(client, records, today)

    write_sources_md(records, today)
    ok_cnt = sum(1 for r in records if r["status"] == "OK")
    print(f"Selesai: {ok_cnt}/{len(records)} entri berhasil. Rincian ditulis ke {SOURCES_MD}")
    for r in records:
        print(f"  [{r['status']}] {r['source']} -> {r['local_path']} ({r['size']})")


if __name__ == "__main__":
    main()
