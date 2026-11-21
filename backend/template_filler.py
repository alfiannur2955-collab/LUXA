"""
OTTV 3D Parametric Studio — Lossless OOXML Zip/XML Template Filler
==================================================================
Mengisi sel langsung ke dalam XML di dalam arsip ZIP `.xlsx` TANPA membuka-lalu-menyimpan
dengan `openpyxl`, sehingga seluruh `<dataValidations>`, `<x14:dataValidations>`,
`<drawing>`, format, dan ekstensi Excel modern (`mc:Ignorable`, `xr:*`) tetap utuh 100%.

Pendekatan pure zip + string/XML patch pada `<sheetData>` ini dirancang agar dapat
dipindahkan 1-ke-1 ke browser menggunakan JSZip pada Fase 5.
"""

from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
import zipfile
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union
from xml.sax.saxutils import escape as xml_escape


_CELL_REF_RE = re.compile(r"^([A-Z]+)(\d+)$")
_ROW_TAG_RE = re.compile(
    r'(<row\b[^>]*\br="(\d+)"[^>]*[^/]>)(.*?)(</row>)|(<row\b[^>]*\br="(\d+)"[^>]*/>)',
    re.DOTALL,
)
_CELL_TAG_RE = re.compile(
    r'<c\b([^>/]*?)\br="([A-Z]+\d+)"([^>/]*?)(?:/>|>(.*?)</c>)',
    re.DOTALL,
)
_SINGLE_OPEN_CELL_RE = re.compile(r'<c\b([^>]*[^/])>((?:(?!</c>).)*?)</c>', re.DOTALL)
_SHEET_DATA_RE = re.compile(r'(<sheetData\b[^>]*>)(.*?)(</sheetData>)', re.DOTALL)
_CALC_PR_RE = re.compile(r'<calcPr\b([^>]*?)(/?)>')
_STYLE_ATTR_RE = re.compile(r'\bs="(\d+)"')
_TYPE_ATTR_RE = re.compile(r'\s*\bt="[^"]*"')


def col_letters_to_index(col: str) -> int:
    """Converts Excel column letters ('A'->1, 'Z'->26, 'AA'->27)."""
    n = 0
    for ch in col.upper():
        n = n * 26 + (ord(ch) - ord("A") + 1)
    return n


def parse_cell_ref(cell_ref: str) -> Tuple[str, int, int]:
    """Returns `(col_letters, col_idx, row_num)` for an A1 reference like `'H6'`."""
    m = _CELL_REF_RE.match(cell_ref.strip().upper())
    if not m:
        raise ValueError(f"Referensi sel tidak valid: {cell_ref!r}")
    col_s, row_s = m.group(1), m.group(2)
    return col_s, col_letters_to_index(col_s), int(row_s)


def get_sheet_xml_paths(zf: zipfile.ZipFile) -> Dict[str, str]:
    """
    Reads `xl/workbook.xml` and `xl/_rels/workbook.xml.rels` to map
    exact worksheet display names (e.g. `'Mat'`, `'UTARA'`, `'SUMMARY OTTV'`)
    to their archive paths (e.g. `'xl/worksheets/sheet2.xml'`).
    """
    wb_root = ET.fromstring(zf.read("xl/workbook.xml"))
    rels_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))

    rel_target_by_id: Dict[str, str] = {}
    for rel in rels_root:
        if rel.tag.endswith("Relationship"):
            rid = rel.attrib.get("Id")
            target = rel.attrib.get("Target", "")
            if rid and target:
                norm = target.lstrip("/")
                if not norm.startswith("xl/"):
                    norm = f"xl/{norm}"
                rel_target_by_id[rid] = norm

    sheet_map: Dict[str, str] = {}
    for elem in wb_root.iter():
        if elem.tag.endswith("}sheet") or elem.tag == "sheet":
            name = elem.attrib.get("name")
            rid = None
            for k, v in elem.attrib.items():
                if k.endswith("}id") or k == "r:id":
                    rid = v
                    break
            if name and rid and rid in rel_target_by_id:
                sheet_map[name] = rel_target_by_id[rid]
    return sheet_map


def _build_cell_xml(cell_ref: str, value: Any, style_id: Optional[str] = None) -> str:
    """
    Constructs an OOXML `<c ...>` element preserving style `s="..."`.
    - `None` or `""` -> empty cell `<c r="..." s="..."/>`
    - `bool` -> `<c r="..." s="..." t="b"><v>1|0</v></c>`
    - `int` / `float` -> `<c r="..." s="..."><v>num</v></c>`
    - `str` -> `<c r="..." s="..." t="inlineStr"><is><t ...>escaped</t></is></c>`
      (inlineStr avoids mutating `xl/sharedStrings.xml` and works identically in Excel & JSZip).
    """
    s_attr = f' s="{style_id}"' if style_id is not None else ""
    if value is None or value == "":
        return f'<c r="{cell_ref}"{s_attr}/>'
    if isinstance(value, bool):
        return f'<c r="{cell_ref}"{s_attr} t="b"><v>{1 if value else 0}</v></c>'
    if isinstance(value, (int, float)):
        num_str = str(value) if isinstance(value, int) else f"{float(value):.10g}"
        return f'<c r="{cell_ref}"{s_attr}><v>{num_str}</v></c>'
    text = str(value)
    escaped = xml_escape(text)
    space_attr = ' xml:space="preserve"' if (text.startswith(" ") or text.endswith(" ") or "\n" in text) else ""
    return f'<c r="{cell_ref}"{s_attr} t="inlineStr"><is><t{space_attr}>{escaped}</t></is></c>'


def _strip_formula_cached_values(sheet_data_inner: str) -> str:
    """
    Removes cached `<v>...</v>` values ONLY from individual formula cells
    `<c ...><f ...>...</f><v>...</v></c>` without ever touching value cells.
    """
    def _repl(m: re.Match[str]) -> str:
        attrs = m.group(1)
        body = m.group(2)
        if ("<f>" not in body and "<f " not in body) or ("<v>" not in body and "<v " not in body):
            return m.group(0)
        new_body = re.sub(r"<v\b[^>]*>.*?</v>", "", body, flags=re.DOTALL)
        new_attrs = _TYPE_ATTR_RE.sub("", attrs)
        return f"<c{new_attrs}>{new_body}</c>"

    return _SINGLE_OPEN_CELL_RE.sub(_repl, sheet_data_inner)


def _patch_row_cells(row_inner: str, row_num: int, col_updates: Dict[int, Tuple[str, Any]]) -> str:
    """Replaces existing `<c>` cells and inserts missing ones in ascending column order."""
    existing_cells: List[Tuple[int, str, Optional[str], str]] = []
    # (col_idx, cell_ref, style_id, raw_xml)
    for m in _CELL_TAG_RE.finditer(row_inner):
        attr_pre, cref, attr_post = m.group(1), m.group(2), m.group(3)
        _, c_idx, _ = parse_cell_ref(cref)
        full_attrs = f"{attr_pre} {attr_post}"
        sm = _STYLE_ATTR_RE.search(full_attrs)
        style_id = sm.group(1) if sm else None
        existing_cells.append((c_idx, cref.upper(), style_id, m.group(0)))

    by_col: Dict[int, str] = {}
    style_by_col: Dict[int, Optional[str]] = {}
    for c_idx, _, style_id, raw_xml in existing_cells:
        by_col[c_idx] = raw_xml
        style_by_col[c_idx] = style_id

    for c_idx, (cref, val) in col_updates.items():
        by_col[c_idx] = _build_cell_xml(cref, val, style_by_col.get(c_idx))

    return "".join(by_col[k] for k in sorted(by_col.keys()))


def patch_worksheet_xml(
    sheet_xml: str,
    cell_updates: Dict[str, Any],
    clear_formula_cache: bool = True,
) -> str:
    """
    Patches ONLY `<sheetData>...</sheetData>` inside a worksheet XML string.
    All namespaces, `<dataValidations>`, `<drawing>`, and `<extLst><x14:dataValidations>`
    remain 100% untouched byte-for-byte.
    """
    sd_match = _SHEET_DATA_RE.search(sheet_xml)
    if not sd_match:
        return sheet_xml

    sd_open, sd_inner, sd_close = sd_match.group(1), sd_match.group(2), sd_match.group(3)

    # Group requested cell updates by row number -> {col_idx: (cell_ref, value)}
    updates_by_row: Dict[int, Dict[int, Tuple[str, Any]]] = {}
    for ref, val in (cell_updates or {}).items():
        col_s, col_idx, row_num = parse_cell_ref(ref)
        updates_by_row.setdefault(row_num, {})[col_idx] = (f"{col_s}{row_num}", val)

    if updates_by_row:
        rows_by_num: Dict[int, str] = {}
        for rm in _ROW_TAG_RE.finditer(sd_inner):
            if rm.group(2) is not None:
                rnum = int(rm.group(2))
                open_tag, inner_xml, close_tag = rm.group(1), rm.group(3), rm.group(4)
                if rnum in updates_by_row:
                    patched_inner = _patch_row_cells(inner_xml, rnum, updates_by_row[rnum])
                    rows_by_num[rnum] = f"{open_tag}{patched_inner}{close_tag}"
                else:
                    rows_by_num[rnum] = rm.group(0)
            else:
                rnum = int(rm.group(6))
                if rnum in updates_by_row:
                    # Expand self-closing <row r="N" .../> into <row r="N" ...>cells</row>
                    open_tag = rm.group(5)[:-2] + ">"
                    patched_inner = _patch_row_cells("", rnum, updates_by_row[rnum])
                    rows_by_num[rnum] = f"{open_tag}{patched_inner}</row>"
                else:
                    rows_by_num[rnum] = rm.group(0)

        # Insert any brand-new rows that did not exist in the template
        for rnum, col_map in updates_by_row.items():
            if rnum not in rows_by_num:
                cells_xml = _patch_row_cells("", rnum, col_map)
                rows_by_num[rnum] = f'<row r="{rnum}">{cells_xml}</row>'

        sd_inner = "".join(rows_by_num[k] for k in sorted(rows_by_num.keys()))

    if clear_formula_cache:
        sd_inner = _strip_formula_cached_values(sd_inner)

    return sheet_xml[:sd_match.start()] + sd_open + sd_inner + sd_close + sheet_xml[sd_match.end():]


def set_workbook_full_calc_on_load(workbook_xml: str) -> str:
    """Ensures `<calcPr ... fullCalcOnLoad="1"/>` is set in `xl/workbook.xml`."""
    m = _CALC_PR_RE.search(workbook_xml)
    if m:
        attrs = m.group(1)
        slash = m.group(2)
        if "fullCalcOnLoad=" in attrs:
            new_attrs = re.sub(r'fullCalcOnLoad="[^"]*"', 'fullCalcOnLoad="1"', attrs)
        else:
            new_attrs = f'{attrs} fullCalcOnLoad="1"'
        new_tag = f"<calcPr{new_attrs}{slash}>"
        return workbook_xml[:m.start()] + new_tag + workbook_xml[m.end():]
    return workbook_xml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>')


def fill_xlsx_template(
    template_source: Union[str, bytes],
    sheet_updates: Dict[str, Dict[str, Any]],
    clear_formula_cache_sheets: Optional[Iterable[str]] = None,
) -> bytes:
    """
    Fills an `.xlsx` template purely via zip/XML patching and returns the output bytes.
    - `sheet_updates`: `{sheet_name: {cell_ref: value, ...}}`
    - `clear_formula_cache_sheets`: sheet names whose formula `<v>` cache should be stripped
      (defaults to all sheets in `sheet_updates` plus `SUMMARY OTTV`, `BO`, `BO. wallmaterial`).
    """
    src_buf = io.BytesIO(template_source) if isinstance(template_source, (bytes, bytearray)) else None
    in_arg: Union[str, io.BytesIO] = src_buf if src_buf is not None else str(template_source)

    out_buf = io.BytesIO()
    with zipfile.ZipFile(in_arg, "r") as zin:
        sheet_paths = get_sheet_xml_paths(zin)
        path_to_sheet = {v: k for k, v in sheet_paths.items()}

        if clear_formula_cache_sheets is None:
            clear_set = set(sheet_updates.keys()) | {"SUMMARY OTTV", "BO", "BO. wallmaterial"}
        else:
            clear_set = set(clear_formula_cache_sheets)

        with zipfile.ZipFile(out_buf, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                raw = zin.read(item.filename)
                if item.filename == "xl/workbook.xml":
                    wb_txt = raw.decode("utf-8")
                    wb_txt = set_workbook_full_calc_on_load(wb_txt)
                    zout.writestr(item, wb_txt.encode("utf-8"))
                elif item.filename in path_to_sheet:
                    sh_name = path_to_sheet[item.filename]
                    updates = sheet_updates.get(sh_name)
                    do_clear = sh_name in clear_set
                    if updates is not None or do_clear:
                        sh_txt = raw.decode("utf-8")
                        sh_txt = patch_worksheet_xml(sh_txt, updates or {}, clear_formula_cache=do_clear)
                        zout.writestr(item, sh_txt.encode("utf-8"))
                    else:
                        zout.writestr(item, raw)
                else:
                    zout.writestr(item, raw)

    return out_buf.getvalue()


def inspect_template_validations(xlsx_source: Union[str, bytes]) -> Dict[str, Dict[str, int]]:
    """
    Counts `<dataValidation>` and `<x14:dataValidation>` elements per worksheet directly from XML,
    allowing tests to assert zero loss of Excel data validations.
    """
    src: Union[str, io.BytesIO] = io.BytesIO(xlsx_source) if isinstance(xlsx_source, (bytes, bytearray)) else str(xlsx_source)
    counts: Dict[str, Dict[str, int]] = {}
    with zipfile.ZipFile(src, "r") as zf:
        for sh_name, path in get_sheet_xml_paths(zf).items():
            txt = zf.read(path).decode("utf-8", errors="ignore")
            dv_std = len(re.findall(r"<dataValidation\b", txt))
            dv_x14 = len(re.findall(r"<x14:dataValidation\b", txt))
            counts[sh_name] = {"dv_std": dv_std, "dv_x14": dv_x14}
    return counts
