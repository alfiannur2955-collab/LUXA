"""T1 (Review Fase 4c): Color fidelity test between legend scale and 3D viewer material.

Verifies that Heatmap and Orientasi facades rendered with `makeColorAccurateMaterial`
match the CSS legend colors within CIE76 ΔE <= 10 for camera-facing (and 45°-oblique)
surfaces in both light and dark themes.
"""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
THEME_CSS = FRONTEND_DIR / "src" / "theme.css"
VIEWER_JS = FRONTEND_DIR / "src" / "viewer" / "viewer.js"


def _find_node_binary() -> str:
    found = shutil.which("node")
    if found:
        return found
    for candidate in (
        r"E:\APPS\ARCHICAD\ARCHICAD 30\node.exe",
        r"C:\Program Files\nodejs\node.exe",
    ):
        if os.path.exists(candidate):
            return candidate
    pytest.skip("Node.js binary not available in PATH")


def _extract_theme_tokens() -> dict[str, dict[str, str]]:
    text = THEME_CSS.read_text(encoding="utf-8")
    light_match = re.search(r":root,\s*\.app\s*\{([^}]+)\}", text)
    dark_match = re.search(r':root\[data-theme="dark"\],\s*\.app\.dark\s*\{([^}]+)\}', text)
    assert light_match and dark_match, "Could not locate light/dark theme token blocks in theme.css"

    def _parse(block: str) -> dict[str, str]:
        raw = dict(re.findall(r"--([a-z0-9-]+)\s*:\s*([^;]+);", block))
        return {
            "glazing": raw["data-glazing"].strip(),
            "wall": raw["data-wall"].strip(),
            "shading": raw["data-shading"].strip(),
            "heat0": raw["heat-0"].strip(),
            "heat1": raw["heat-1"].strip(),
            "heat2": raw["heat-2"].strip(),
            "heat3": raw["heat-3"].strip(),
        }

    return {"light": _parse(light_match.group(1)), "dark": _parse(dark_match.group(1))}


def _srgb_to_lab(r255: float, g255: float, b255: float) -> tuple[float, float, float]:
    def _lin(u: float) -> float:
        s = max(0.0, min(1.0, u / 255.0))
        return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = _lin(r255), _lin(g255), _lin(b255)
    # sRGB D65 -> XYZ
    x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
    y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / 1.00000
    z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883

    def _f(t: float) -> float:
        return t ** (1.0 / 3.0) if t > 0.008856 else 7.787 * t + 16.0 / 116.0

    fx, fy, fz = _f(x), _f(y), _f(z)
    return (116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz))


def _delta_e76(rgb_a: tuple[float, float, float], rgb_b: tuple[float, float, float]) -> float:
    la, aa, ba = _srgb_to_lab(*rgb_a)
    lb, ab, bb = _srgb_to_lab(*rgb_b)
    return math.sqrt((la - lb) ** 2 + (aa - ab) ** 2 + (ba - bb) ** 2)


def _parse_rgb_css(rgb_str: str) -> tuple[float, float, float]:
    m = re.match(r"rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)", rgb_str.strip())
    assert m, f"Unexpected CSS rgb format: {rgb_str}"
    return (float(m.group(1)), float(m.group(2)), float(m.group(3)))


def test_heatmap_and_orientation_material_matches_legend_delta_e_under_10() -> None:
    node_bin = _find_node_binary()
    themes = _extract_theme_tokens()

    script = r"""
import {
  ORIENTATION_CODES,
  computeColorAccurateShade,
  makeColorAccurateMaterial,
  orientationToCssColor,
  orientationToThreeColor,
  ottvToHeatCssVar,
  ottvToThreeColor,
} from './src/viewer/modes.js';

const themes = JSON.parse(process.env.THEMES_JSON);
const linToSrgb = (c) => {
  const clamped = Math.max(0, Math.min(1, c));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
};

const mat = makeColorAccurateMaterial({ transparent: false, opacity: 1.0 });
const shadeFront = computeColorAccurateShade(0, 0, 1);
const shadeOblique45 = computeColorAccurateShade(Math.SQRT1_2, 0, Math.SQRT1_2);
const shadeSide = computeColorAccurateShade(1, 0, 0);

const testValues = [0, 14.76, 18.57, 21.08, 24.80, 25, 27.71, 35, 38.79, 49.68, 50, 60];
const out = {
  materialType: mat.type,
  vertexColors: Boolean(mat.vertexColors),
  hasColorspaceFragment: String(mat.fragmentShader || '').includes('#include <colorspace_fragment>'),
  shadeFront,
  shadeOblique45,
  shadeSide,
  results: {},
};

for (const [themeName, tokens] of Object.entries(themes)) {
  const heatmap = testValues.map((v) => {
    const c = ottvToThreeColor(v, tokens);
    return {
      val: v,
      legendCss: ottvToHeatCssVar(v, tokens),
      frontRgb: [
        Math.round(linToSrgb(c.r * shadeFront) * 255),
        Math.round(linToSrgb(c.g * shadeFront) * 255),
        Math.round(linToSrgb(c.b * shadeFront) * 255),
      ],
      obliqueRgb: [
        Math.round(linToSrgb(c.r * shadeOblique45) * 255),
        Math.round(linToSrgb(c.g * shadeOblique45) * 255),
        Math.round(linToSrgb(c.b * shadeOblique45) * 255),
      ],
    };
  });
  const orientations = ORIENTATION_CODES.map((code) => {
    const c = orientationToThreeColor(code, tokens);
    return {
      code,
      legendCss: orientationToCssColor(code, tokens),
      frontRgb: [
        Math.round(linToSrgb(c.r * shadeFront) * 255),
        Math.round(linToSrgb(c.g * shadeFront) * 255),
        Math.round(linToSrgb(c.b * shadeFront) * 255),
      ],
    };
  });
  out.results[themeName] = { heatmap, orientations };
}

console.log(JSON.stringify(out));
"""

    env = dict(os.environ)
    env["THEMES_JSON"] = json.dumps(themes)
    proc = subprocess.run(
        [node_bin, "--input-type=module", "-e", script],
        cwd=str(FRONTEND_DIR),
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(proc.stdout)

    assert payload["materialType"] == "ShaderMaterial"
    assert payload["vertexColors"] is True
    assert payload["hasColorspaceFragment"] is True
    # Directional shading stays within <= 15% attenuation across all surface angles
    assert payload["shadeSide"] >= 0.85
    assert payload["shadeFront"] >= 0.95

    for theme_name, theme_res in payload["results"].items():
        for row in theme_res["heatmap"]:
            legend_rgb = _parse_rgb_css(row["legendCss"])
            de_front = _delta_e76(legend_rgb, tuple(row["frontRgb"]))
            de_oblique = _delta_e76(legend_rgb, tuple(row["obliqueRgb"]))
            assert de_front <= 10.0, (
                f"[{theme_name}] Heatmap v={row['val']}: front ΔE={de_front:.2f} > 10 "
                f"(legend={legend_rgb}, front={row['frontRgb']})"
            )
            assert de_oblique <= 10.0, (
                f"[{theme_name}] Heatmap v={row['val']}: oblique ΔE={de_oblique:.2f} > 10 "
                f"(legend={legend_rgb}, oblique={row['obliqueRgb']})"
            )

        # Box example check: S (14.76) and T (21.08) must be perceptibly distinct on the 3D mesh
        by_val = {r["val"]: tuple(r["frontRgb"]) for r in theme_res["heatmap"]}
        de_s_vs_t = _delta_e76(by_val[14.76], by_val[21.08])
        assert de_s_vs_t >= 5.0, f"[{theme_name}] S 14.76 vs T 21.08 too similar: ΔE={de_s_vs_t:.2f}"

        for row in theme_res["orientations"]:
            legend_rgb = _parse_rgb_css(row["legendCss"])
            de_front = _delta_e76(legend_rgb, tuple(row["frontRgb"]))
            assert de_front <= 10.0, (
                f"[{theme_name}] Orientation {row['code']}: front ΔE={de_front:.2f} > 10 "
                f"(legend={legend_rgb}, front={row['frontRgb']})"
            )


def test_viewer_wires_color_accurate_material_for_heatmap_and_orientation() -> None:
    viewer_src = VIEWER_JS.read_text(encoding="utf-8")
    assert "makeColorAccurateMaterial" in viewer_src
    assert "mode === 'heatmap' || mode === 'orientation'" in viewer_src
