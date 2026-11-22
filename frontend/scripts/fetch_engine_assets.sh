#!/usr/bin/env bash
# Downloads the in-browser engine binaries into frontend/.engine-cache/ (gitignored, ~40 MB).
# Sources: Pyodide GitHub release, PyPI, IfcOpenShell wasm-wheels, npm. Versions are pinned:
# Pyodide 0.29.5 (Python 3.13) because IfcOpenShell WASM wheels exist for Python 3.13 only.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=.engine-cache
PYO=0.29.5
mkdir -p "$DEST/pyodide" "$DEST/wheels" "$DEST/rhino3dm" .tmp-engine
if [ ! -f "$DEST/pyodide/pyodide.asm.wasm" ]; then
  curl -sL -o .tmp-engine/pyodide.tar.bz2 "https://github.com/pyodide/pyodide/releases/download/${PYO}/pyodide-${PYO}.tar.bz2"
  tar -xjf .tmp-engine/pyodide.tar.bz2 -C .tmp-engine \
    pyodide/pyodide.mjs pyodide/pyodide.js pyodide/pyodide.asm.js pyodide/pyodide.asm.wasm \
    pyodide/python_stdlib.zip pyodide/pyodide-lock.json pyodide/package.json \
    pyodide/numpy-2.2.5-cp313-cp313-pyemscripten_2025_0_wasm32.whl \
    pyodide/pydantic-2.12.5-py3-none-any.whl \
    pyodide/pydantic_core-2.41.5-cp313-cp313-pyemscripten_2025_0_wasm32.whl \
    pyodide/typing_extensions-4.15.0-py3-none-any.whl pyodide/annotated_types-0.7.0-py3-none-any.whl \
    pyodide/typing_inspection-0.4.2-py3-none-any.whl pyodide/micropip-0.11.1-py3-none-any.whl \
    pyodide/packaging-26.2-py3-none-any.whl
  cp .tmp-engine/pyodide/* "$DEST/pyodide/"
fi
pypi() { python3 -c "import json,urllib.request as u;d=json.load(u.urlopen('https://pypi.org/pypi/$1/json'));print([x['url'] for x in d['urls'] if x['filename'].endswith('none-any.whl')][0])"; }
for spec in trimesh/5.2.1 ladybug-geometry/1.35.10 openpyxl/3.1.5 et-xmlfile/2.0.0; do
  (cd "$DEST/wheels" && curl -sL -O "$(pypi "$spec")")
done
IFC_V="0.9.1+a963c38"; IFC_B="https://raw.githubusercontent.com/IfcOpenShell/wasm-wheels/main/modular/0.9.1%2Ba963c38"
for n in ifcopenshell ifcopenshell_parse_schema_ifc2x3 ifcopenshell_parse_schema_ifc4 ifcopenshell_parse_schema_ifc4x3_add2 \
         ifcopenshell_geometry_mapping_ifc2x3 ifcopenshell_geometry_mapping_ifc4 ifcopenshell_geometry_mapping_ifc4x3_add2 \
         ifcopenshell_geometry_kernel_opencascade; do
  f="${n}-${IFC_V}-cp313-cp313-pyemscripten_2025_0_wasm32.whl"
  (cd "$DEST/wheels" && curl -sL -o "$f" "${IFC_B}/${f//+/%2B}")
done
(cd "$DEST/wheels" && curl -sL -o "ifcopenshell_pure_python-${IFC_V}-py3-none-any.whl" "${IFC_B}/ifcopenshell_pure_python-0.9.1%2Ba963c38-py3-none-any.whl")
(cd .tmp-engine && npm pack rhino3dm@8.35.0 --silent >/dev/null && tar -xzf rhino3dm-8.35.0.tgz && cp package/rhino3dm.module.js package/rhino3dm.wasm "../$DEST/rhino3dm/")
rm -rf .tmp-engine
du -sh "$DEST"/*
