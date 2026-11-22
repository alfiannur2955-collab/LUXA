/**
 * Saved camera views (`docs/FASE4_UI_SPEC.md` §4.7).
 * Stored inside `ProjectConfig.saved_views` so they automatically persist
 * in `.ottv.json` and `localStorage` autosave.
 */

import { formatCameraDirectionLabel, PROJECTION_SHORT } from './cameras.js';

export function suggestViewName(projection, direction, existingViews = []) {
  const dirPhrase = formatCameraDirectionLabel(projection, direction);
  const projLabel = PROJECTION_SHORT[projection] || 'Persp';
  const base = projection === 'elevation' ? dirPhrase : `${dirPhrase} · ${projLabel}`;
  const existing = new Set((existingViews || []).map((v) => String(v.name || '').trim().toLowerCase()));
  if (!existing.has(base.toLowerCase())) return base;
  let idx = 2;
  while (existing.has(`${base} (${idx})`.toLowerCase())) {
    idx += 1;
  }
  return `${base} (${idx})`;
}

export function createSavedViewRecord({ name, cameraState, northAngleDeg = 0, heatmapSmooth = false }) {
  const cleanName = String(name || '').trim() || 'View baru';
  const id = `view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    name: cleanName,
    projection: cameraState?.projection || 'perspective',
    direction: cameraState?.direction || 'TG',
    north_angle_deg: Number(northAngleDeg) || 0,
    heatmap_smooth: Boolean(heatmapSmooth),
    camera: { ...cameraState },
    created_at: new Date().toISOString(),
  };
}

export function renameSavedViewInList(views, viewId, newName) {
  const clean = String(newName || '').trim();
  if (!clean) return views;
  return (views || []).map((v) => (v.id === viewId ? { ...v, name: clean } : v));
}

export function duplicateSavedViewInList(views, viewId) {
  const src = (views || []).find((v) => v.id === viewId);
  if (!src) return { views, copy: null };
  const copy = {
    ...src,
    id: `view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: `${src.name} (Salinan)`,
    camera: src.camera ? { ...src.camera } : null,
    created_at: new Date().toISOString(),
  };
  return { views: [...(views || []), copy], copy };
}

export function deleteSavedViewInList(views, viewId) {
  return (views || []).filter((v) => v.id !== viewId);
}
