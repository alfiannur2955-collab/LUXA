#!/usr/bin/env bash
# Fase 5a spike: download the assets the browser engine needs into spike-pyodide/vendor/
# (gitignored). Sources: Pyodide GitHub release, PyPI, IfcOpenShell wasm-wheels, npm.
set -euo pipefail
cd "$(dirname "$0")"
PYO=0.29.5
mkdir -p vendor/pyodide vendor/wheels vendor/rhino3dm .tmp
if [ ! -f vendor/pyodide/pyodide.asm.wasm ]; then
  curl -sL -o .tmp/pyodide.tar.bz2 "https://github.com/pyodide/pyodide/releases/download/${PYO}/pyodide-${PYO}.tar.bz2"
  tar -xjf .tmp/pyodide.tar.bz2 -C .tmp \
    pyodide/pyodide.mjs pyodide/pyodide.js pyodide/pyodide.asm.js pyodide/pyodide.asm.wasm \
    pyodide/python_stdlib.zip pyodide/pyodide-lock.json pyodide/package.json \
    pyodide/numpy-2.2.5-cp313-cp313-pyemscripten_2025_0_wasm32.whl \
    pyodide/pydantic-2.12.5-py3-none-any.whl \
    pyodide/pydantic_core-2.41.5-cp313-cp313-pyemscripten_2025_0_wasm32.whl \
    pyodide/typing_extensions-4.15.0-py3-none-any.whl pyodide/annotated_types-0.7.0-py3-none-any.whl \
    pyodide/typing_inspection-0.4.2-py3-none-any.whl pyodide/micropip-0.11.1-py3-none-any.whl \
    pyodide/packaging-26.2-py3-none-any.whl
  cp .tmp/pyodide/* vendor/pyodide/
fi
pypi() { python3 -c "import json,sys,urllib.request as u;d=json.load(u.urlopen('https://pypi.org/pypi/$1/json'));print([x['url'] for x in d['urls'] if x['filename'].endswith('none-any.whl')][0])"; }
for spec in trimesh/5.2.1 ladybug-geometry/1.35.10 openpyxl/3.1.5 et-xmlfile/2.0.0; do
  (cd vendor/wheels && curl -sL -O "$(pypi "$spec")")
done
# IfcOpenShell modular WASM build 0.9.1 (built against Pyodide 0.29.3). The monolithic
# 0.9.0.post1 wheel crashes in ifcopenshell.open() on Pyodide 0.29.5 (memory access out of bounds).
IFC_V="0.9.1+a963c38"; IFC_B="https://raw.githubusercontent.com/IfcOpenShell/wasm-wheels/main/modular/0.9.1%2Ba963c38"
for n in ifcopenshell ifcopenshell_parse_schema_ifc2x3 ifcopenshell_parse_schema_ifc4 ifcopenshell_parse_schema_ifc4x3_add2 \
         ifcopenshell_geometry_mapping_ifc2x3 ifcopenshell_geometry_mapping_ifc4 ifcopenshell_geometry_mapping_ifc4x3_add2 \
         ifcopenshell_geometry_kernel_opencascade; do
  f="${n}-${IFC_V}-cp313-cp313-pyemscripten_2025_0_wasm32.whl"
  (cd vendor/wheels && curl -sL -o "$f" "${IFC_B}/${f//+/%2B}")
done
(cd vendor/wheels && curl -sL -o "ifcopenshell_pure_python-${IFC_V}-py3-none-any.whl" "${IFC_B}/ifcopenshell_pure_python-0.9.1%2Ba963c38-py3-none-any.whl")
(cd .tmp && npm pack rhino3dm@8.35.0 --silent >/dev/null && tar -xzf rhino3dm-8.35.0.tgz && cp package/rhino3dm.module.js package/rhino3dm.wasm ../vendor/rhino3dm/)
rm -rf .tmp
du -sh vendor/*
