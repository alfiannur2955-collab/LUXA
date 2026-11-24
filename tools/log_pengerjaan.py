"""
Buat linimasa pengerjaan LUXA dari riwayat git (untuk laporan aplikasi).

Pakai:  python tools/log_pengerjaan.py            -> menulis docs/LOG_GIT_OTOMATIS.md
        python tools/log_pengerjaan.py --sejak 2026-11-24

Waktu ditampilkan dalam WIB (UTC+7). Jalankan ulang kapan saja; file hasilnya ditimpa.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import os
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WIB = dt.timezone(dt.timedelta(hours=7))
HARI = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
BULAN = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sejak", help="tanggal awal YYYY-MM-DD (WIB)")
    ap.add_argument("--keluar", default=os.path.join(ROOT, "docs", "LOG_GIT_OTOMATIS.md"))
    a = ap.parse_args()

    raw = subprocess.run(
        ["git", "log", "--reverse", "--format=%h%x1f%at%x1f%s%x1f%an"],
        cwd=ROOT, capture_output=True, text=True, check=True, encoding="utf-8",
    ).stdout.strip().splitlines()
    rows = []
    for line in raw:
        h, ts, subj, author = line.split("\x1f")
        t = dt.datetime.fromtimestamp(int(ts), WIB)
        if a.sejak and t.date() < dt.date.fromisoformat(a.sejak):
            continue
        rows.append((t, h, subj, author))

    by_day = collections.OrderedDict()
    for r in rows:
        by_day.setdefault(r[0].date(), []).append(r)

    out = [
        "# Log Pengerjaan LUXA (otomatis dari git)",
        "",
        f"Dibuat {dt.datetime.now(WIB):%d %b %Y %H:%M} WIB oleh `tools/log_pengerjaan.py`. Jangan edit manual; jalankan ulang skripnya.",
        "Ringkasan naratif dan angka hasil ada di `docs/LOG_PENGERJAAN.md`.",
        "",
        f"Total {len(rows)} commit dalam {len(by_day)} hari kerja.",
        "",
        "| Tanggal | Commit | Jam pertama–terakhir (WIB) |",
        "|---|---|---|",
    ]
    for d, rs in by_day.items():
        out.append(f"| {HARI[d.weekday()]}, {d.day} {BULAN[d.month]} {d.year} | {len(rs)} | {rs[0][0]:%H:%M}–{rs[-1][0]:%H:%M} |")
    for d, rs in by_day.items():
        out += ["", f"## {HARI[d.weekday()]}, {d.day} {BULAN[d.month]} {d.year}", "", "| Jam | Commit | Perubahan |", "|---|---|---|"]
        for t, h, subj, _ in rs:
            out.append(f"| {t:%H:%M} | `{h}` | {subj.replace('|', '/')} |")
    os.makedirs(os.path.dirname(a.keluar), exist_ok=True)
    with open(a.keluar, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(f"ditulis: {a.keluar} ({len(rows)} commit)")


if __name__ == "__main__":
    main()
