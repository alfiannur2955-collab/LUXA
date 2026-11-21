/**
 * LUXA Panel Selection Logic (`docs/FASE4_UI_SPEC.md` §4.3):
 * - Click selects a single panel by `panels[].id`
 * - Shift+click adds/toggles panel in selection
 * - Click empty area clears selection
 * - Summarizes single panel (group, SF/SC/Uf or alpha/Uw/TDek, contribution,
 *   orientation same-type heat share %) and multi-selection (total area,
 *   area-weighted average contribution, total heat share %).
 * - Builds 3D highlight mesh overlay in `tokens.sun`.
 */

import * as THREE from 'three';
import { toThreeCoords } from './cameras.js';
import { ORIENTATION_NAMES_ID } from './modes.js';

export function togglePanelSelection(currentIds, panelId, additive = false) {
  const prev = Array.isArray(currentIds) ? currentIds : [];
  if (!panelId) return [];
  if (!additive) {
    if (prev.length === 1 && prev[0] === panelId) return [panelId];
    return [panelId];
  }
  if (prev.includes(panelId)) {
    return prev.filter((id) => id !== panelId);
  }
  return [...prev, panelId];
}

export function panelTypeLabel(elementType) {
  if (elementType === 'glazing' || elementType === 'composite_cw') return 'Panel kaca';
  if (elementType === 'spandrel') return 'Panel spandrel';
  return 'Panel dinding';
}

export function isGlazingPanel(panel) {
  return panel?.element_type === 'glazing' || panel?.element_type === 'composite_cw';
}

/**
 * Summarizes the selected panels against full `analysisData`.
 */
export function summarizeSelectedPanels(analysisData, selectedPanelIds) {
  if (!analysisData?.panels?.length || !Array.isArray(selectedPanelIds) || selectedPanelIds.length === 0) {
    return null;
  }

  const activePanels = analysisData.panels.filter((p) => p && p.active);
  if (activePanels.length === 0) return null;

  const byId = new Map(activePanels.map((p) => [p.id, p]));
  const selected = selectedPanelIds.map((id) => byId.get(id)).filter(Boolean);
  if (selected.length === 0) return null;

  let totalBuildingHeatW = 0;
  for (const p of activePanels) {
    totalBuildingHeatW += Number(p.heat_gain_w || 0);
  }

  let totalAreaM2 = 0;
  let weightedOttvSum = 0;
  let selectedHeatW = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of selected) {
    const a = Math.max(0, Number(p.area_m2 || 0));
    const ottv = Number(p.ottv_panel_wm2 || 0);
    totalAreaM2 += a;
    weightedOttvSum += ottv * a;
    selectedHeatW += Number(p.heat_gain_w || 0);
    const c = p.centroid || [0, 0, 0];
    cx += Number(c[0] || 0);
    cy += Number(c[1] || 0);
    cz += Number(c[2] || 0);
  }

  const primary = selected[selected.length - 1];
  const isMulti = selected.length > 1;
  const weightedOttvWm2 = totalAreaM2 > 1e-6 ? weightedOttvSum / totalAreaM2 : Number(primary.ottv_panel_wm2 || 0);
  const selectedHeatSharePct = totalBuildingHeatW > 1e-6 ? (selectedHeatW / totalBuildingHeatW) * 100 : 0;

  // Same-type + same-orientation share (e.g. "Seluruh kaca Barat (553,85 m²) menyumbang 32% panas...")
  const primaryIsGlz = isGlazingPanel(primary);
  const primaryDir = primary.orientation_code || 'U';
  let cohortAreaM2 = 0;
  let cohortHeatW = 0;
  for (const p of activePanels) {
    if (p.orientation_code !== primaryDir) continue;
    if (isGlazingPanel(p) !== primaryIsGlz) continue;
    cohortAreaM2 += Math.max(0, Number(p.area_m2 || 0));
    cohortHeatW += Number(p.heat_gain_w || 0);
  }
  const cohortHeatSharePct = totalBuildingHeatW > 1e-6 ? (cohortHeatW / totalBuildingHeatW) * 100 : 0;

  const anchorCentroid = isMulti
    ? [cx / selected.length, cy / selected.length, cz / selected.length]
    : primary.centroid || [0, 0, 0];

  return {
    count: selected.length,
    isMulti,
    panels: selected,
    primary,
    primaryIsGlz,
    primaryDir,
    primaryDirName: ORIENTATION_NAMES_ID[primaryDir] || primaryDir,
    primaryTypeLabel: panelTypeLabel(primary.element_type),
    totalAreaM2,
    weightedOttvWm2,
    selectedHeatW,
    totalBuildingHeatW,
    selectedHeatSharePct,
    cohortAreaM2,
    cohortHeatW,
    cohortHeatSharePct,
    anchorCentroid,
  };
}

/**
 * Builds crisp highlight geometry slightly offset along outward normals for selected panels.
 */
export function populateSelectionHighlightGroup(targetGroup, selectedPanels, tokens) {
  while (targetGroup.children.length > 0) {
    const child = targetGroup.children[0];
    targetGroup.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  }

  if (!Array.isArray(selectedPanels) || selectedPanels.length === 0) return;

  const fillCoords = [];
  const lineCoords = [];

  for (const p of selectedPanels) {
    const vs = p?.vertices;
    if (!Array.isArray(vs) || vs.length < 3) continue;
    const n = p.normal || [0, 0, 0];
    const eps = 0.045;
    const off = (pt) => {
      const v = toThreeCoords(
        Number(pt[0]) + Number(n[0] || 0) * eps,
        Number(pt[1]) + Number(n[1] || 0) * eps,
        Number(pt[2]) + Number(n[2] || 0) * eps,
      );
      return [v.x, v.y, v.z];
    };

    const pts = vs.map(off);
    fillCoords.push(...pts[0], ...pts[1], ...pts[2]);
    if (pts.length >= 4) {
      fillCoords.push(...pts[0], ...pts[2], ...pts[3]);
    }
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      lineCoords.push(...a, ...b);
    }
  }

  if (fillCoords.length > 0) {
    const gFill = new THREE.BufferGeometry();
    gFill.setAttribute('position', new THREE.Float32BufferAttribute(fillCoords, 3));
    const mFill = new THREE.MeshBasicMaterial({
      color: new THREE.Color(tokens.sun),
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(gFill, mFill);
    mesh.raycast = () => {};
    targetGroup.add(mesh);
  }

  if (lineCoords.length > 0) {
    const gLine = new THREE.BufferGeometry();
    gLine.setAttribute('position', new THREE.Float32BufferAttribute(lineCoords, 3));
    const mLine = new THREE.LineBasicMaterial({
      color: new THREE.Color(tokens.sun),
      transparent: false,
      depthTest: false,
    });
    const lines = new THREE.LineSegments(gLine, mLine);
    lines.renderOrder = 10;
    lines.raycast = () => {};
    targetGroup.add(lines);
  }
}
