/**
 * Fase 5b (from the 5a spike): read a .3dm with rhino3dm.js and produce the same chunks as the
 * native Python branch in backend/universal_pipeline.py (`_process_rhino_obj`).
 * The result is written to `<name>.3dm.json` and read by the `.3dm.json` branch there.
 *
 * Mirrors: layer full path + visibility, material source (layer/object/parent),
 * block nesting with 4x4 transforms (depth <= 8), Mesh / Extrusion / Brep meshes,
 * and the M3 "missing render mesh" report. SubD is converted to Brep like Python.
 */
const UNIT_NAMES = { Millimeters: 'mm', Centimeters: 'cm', Meters: 'm', Inches: 'in', Feet: 'ft' };
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';

function enumName(enumObj, value) {
  for (const k of Object.keys(enumObj)) {
    if (k === 'values') continue;
    const e = enumObj[k];
    if (e === value || (e && value && e.value !== undefined && e.value === value.value)) return k;
  }
  return null;
}

function matMul4(a, b) {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i += 1)
    for (let j = 0; j < 4; j += 1)
      for (let k = 0; k < 4; k += 1) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const EPS_PT = 1e-6;
const EPS_AREA = 1e-10;
const EPS_CROSS = 1e-12;

function applyXformPoint(p, xf) {
  if (xf === IDENTITY) return [p[0], p[1], p[2]];
  const x = p[0];
  const y = p[1];
  const z = p[2];
  const w = xf[12] * x + xf[13] * y + xf[14] * z + xf[15] || 1;
  return [
    (xf[0] * x + xf[1] * y + xf[2] * z + xf[3]) / w,
    (xf[4] * x + xf[5] * y + xf[6] * z + xf[7]) / w,
    (xf[8] * x + xf[9] * y + xf[10] * z + xf[11]) / w,
  ];
}

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function signedArea2d(pts) {
  const n = pts.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return 0.5 * s;
}

function cross2d(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointInTriangle2d(p, a, b, c, eps = 1e-10) {
  return cross2d(a, b, p) >= -eps && cross2d(b, c, p) >= -eps && cross2d(c, a, p) >= -eps;
}

function segmentsProperlyIntersect(a, b, c, d) {
  const d1 = cross2d(c, d, a);
  const d2 = cross2d(c, d, b);
  const d3 = cross2d(a, b, c);
  const d4 = cross2d(a, b, d);
  return (
    ((d1 > 1e-10 && d2 < -1e-10) || (d1 < -1e-10 && d2 > 1e-10)) &&
    ((d3 > 1e-10 && d4 < -1e-10) || (d3 < -1e-10 && d4 > 1e-10))
  );
}

function mergeHoleIntoRing(ring, hole, pts2d) {
  let mPos = 0;
  for (let i = 1; i < hole.length; i += 1) {
    const cur = pts2d[hole[i]];
    const best = pts2d[hole[mPos]];
    if (cur[0] > best[0] || (cur[0] === best[0] && cur[1] > best[1])) mPos = i;
  }
  const mPt = pts2d[hole[mPos]];
  const mx = mPt[0];
  const my = mPt[1];
  const nR = ring.length;

  let bestX = Infinity;
  let bestEdge = -1;
  let bestHitVertex = -1;

  for (let i = 0; i < nR; i += 1) {
    const a = pts2d[ring[i]];
    const b = pts2d[ring[(i + 1) % nR]];
    if (Math.abs(a[1] - my) <= 1e-9 && a[0] >= mx - 1e-9) {
      if (a[0] < bestX - 1e-9) {
        bestX = a[0];
        bestEdge = i;
        bestHitVertex = i;
      }
    }
    if ((a[1] <= my && my < b[1]) || (b[1] <= my && my < a[1])) {
      const t = (my - a[1]) / (b[1] - a[1]);
      const ix = a[0] + t * (b[0] - a[0]);
      if (ix >= mx - 1e-9 && ix < bestX - 1e-9) {
        bestX = ix;
        bestEdge = i;
        bestHitVertex = -1;
      }
    }
  }

  let visPos = -1;
  if (bestHitVertex >= 0) {
    visPos = bestHitVertex;
  } else if (bestEdge >= 0) {
    const aPos = bestEdge;
    const bPos = (bestEdge + 1) % nR;
    const pPos = pts2d[ring[aPos]][0] >= pts2d[ring[bPos]][0] ? aPos : bPos;
    const pPt = pts2d[ring[pPos]];
    const iPt = [bestX, my];

    const triCcw = cross2d(mPt, iPt, pPt) >= 0;
    const ta = mPt;
    const tb = triCcw ? iPt : pPt;
    const tc = triCcw ? pPt : iPt;

    let candPos = -1;
    let candAng = Infinity;
    let candDist = Infinity;

    for (let i = 0; i < nR; i += 1) {
      if (i === pPos) continue;
      const rPt = pts2d[ring[i]];
      if (Math.abs(rPt[0] - pPt[0]) <= 1e-9 && Math.abs(rPt[1] - pPt[1]) <= 1e-9) continue;
      if (Math.abs(rPt[0] - mx) <= 1e-9 && Math.abs(rPt[1] - my) <= 1e-9) continue;
      const prevPt = pts2d[ring[(i - 1 + nR) % nR]];
      const nextPt = pts2d[ring[(i + 1) % nR]];
      if (cross2d(prevPt, rPt, nextPt) > 1e-10) continue;
      if (pointInTriangle2d(rPt, ta, tb, tc)) {
        const dx = rPt[0] - mx;
        const dy = rPt[1] - my;
        const dist = Math.hypot(dx, dy);
        const ang = Math.abs(Math.atan2(dy, Math.max(dx, 1e-12)));
        if (ang < candAng - 1e-12 || (Math.abs(ang - candAng) <= 1e-12 && dist < candDist)) {
          candAng = ang;
          candDist = dist;
          candPos = i;
        }
      }
    }
    visPos = candPos >= 0 ? candPos : pPos;
  }

  if (visPos < 0) {
    const order = Array.from({ length: nR }, (_, i) => i).sort(
      (i, j) =>
        Math.hypot(pts2d[ring[i]][0] - mx, pts2d[ring[i]][1] - my) -
        Math.hypot(pts2d[ring[j]][0] - mx, pts2d[ring[j]][1] - my),
    );
    visPos = order[0];
    for (const i of order) {
      const vPt = pts2d[ring[i]];
      let blocked = false;
      for (let j = 0; j < nR; j += 1) {
        if (j === i || (j + 1) % nR === i) continue;
        if (segmentsProperlyIntersect(mPt, vPt, pts2d[ring[j]], pts2d[ring[(j + 1) % nR]])) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        visPos = i;
        break;
      }
    }
  }

  const hRot = [...hole.slice(mPos), ...hole.slice(0, mPos)];
  return [...ring.slice(0, visPos + 1), ...hRot, hRot[0], ring[visPos], ...ring.slice(visPos + 1)];
}

function earClip2d(ring, pts2d) {
  const poly = [...ring];
  const tris = [];
  const samePt = (i, j) => {
    const a = pts2d[i];
    const b = pts2d[j];
    return Math.abs(a[0] - b[0]) <= 1e-9 && Math.abs(a[1] - b[1]) <= 1e-9;
  };

  let changed = true;
  while (changed && poly.length >= 3) {
    changed = false;
    for (let i = 0; i < poly.length && poly.length >= 3; ) {
      const nxt = (i + 1) % poly.length;
      if (samePt(poly[i], poly[nxt])) {
        poly.splice(nxt, 1);
        changed = true;
      } else {
        i += 1;
      }
    }
  }

  const maxGuard = Math.max(16, poly.length * poly.length + 16);
  let steps = 0;
  while (poly.length > 3 && steps < maxGuard) {
    steps += 1;
    const n = poly.length;
    let clipped = false;

    for (let i = 0; i < n; i += 1) {
      const ia = poly[(i - 1 + n) % n];
      const ib = poly[i];
      const ic = poly[(i + 1) % n];
      const a = pts2d[ia];
      const b = pts2d[ib];
      const c = pts2d[ic];
      if (cross2d(a, b, c) <= EPS_CROSS) continue;
      let hasInside = false;
      for (let j = 0; j < n; j += 1) {
        const ij = poly[j];
        if (ij === ia || ij === ib || ij === ic) continue;
        if (samePt(ij, ia) || samePt(ij, ib) || samePt(ij, ic)) continue;
        if (pointInTriangle2d(pts2d[ij], a, b, c)) {
          hasInside = true;
          break;
        }
      }
      if (!hasInside) {
        tris.push([ia, ib, ic]);
        poly.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (clipped) continue;

    for (let i = 0; i < n; i += 1) {
      const ia = poly[(i - 1 + n) % n];
      const ib = poly[i];
      const ic = poly[(i + 1) % n];
      if (Math.abs(cross2d(pts2d[ia], pts2d[ib], pts2d[ic])) <= 1e-9) {
        poly.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (clipped) continue;

    let bestI = -1;
    let bestArea = -1;
    for (let i = 0; i < n; i += 1) {
      const ia = poly[(i - 1 + n) % n];
      const ib = poly[i];
      const ic = poly[(i + 1) % n];
      const area2 = cross2d(pts2d[ia], pts2d[ib], pts2d[ic]);
      if (area2 > bestArea) {
        bestArea = area2;
        bestI = i;
      }
    }
    if (bestI >= 0 && bestArea > EPS_CROSS) {
      const ia = poly[(bestI - 1 + n) % n];
      const ib = poly[bestI];
      const ic = poly[(bestI + 1) % n];
      tris.push([ia, ib, ic]);
      poly.splice(bestI, 1);
    } else {
      break;
    }
  }

  if (poly.length === 3) {
    const [ia, ib, ic] = poly;
    if (Math.abs(cross2d(pts2d[ia], pts2d[ib], pts2d[ic])) > EPS_CROSS) {
      tris.push([ia, ib, ic]);
    }
  }
  return tris;
}

function newellNormal(pts) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = pts.length;
  for (let i = 0; i < n; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

function extractLoopPoints3d(brep, lp) {
  const pts = [];
  const verts = brep.vertices();
  const edges = brep.edges();
  const nVerts = verts.count;
  const nEdges = edges.count;
  const trims = lp.trims;
  for (let ti = 0; ti < trims.count; ti += 1) {
    const tr = trims.get(ti);
    const ei = tr.edgeIndex;
    if (ei < 0 || ei >= nEdges) continue;
    const edge = edges.get(ei);
    const svI = tr.startVertexIndex;
    const evI = tr.endVertexIndex;
    const pStart = svI >= 0 && svI < nVerts ? verts.get(svI).location : null;
    const pEnd = evI >= 0 && evI < nVerts ? verts.get(evI).location : null;

    let isLin = false;
    try {
      isLin = Boolean(edge.isLinear(1e-6));
    } catch {
      isLin = false;
    }
    if (isLin && pStart) {
      pts.push([Number(pStart[0]), Number(pStart[1]), Number(pStart[2])]);
      continue;
    }

    try {
      const dom = edge.domain;
      const t0 = Number(dom[0]);
      const t1 = Number(dom[1]);
      const q0 = edge.pointAt(t0);
      const q1 = edge.pointAt(t1);
      let rev = Boolean(tr.isReversed);
      if (pStart && pEnd && dist3(pStart, pEnd) > EPS_PT) {
        rev = dist3(q1, pStart) < dist3(q0, pStart);
      }
      const ta = rev ? t1 : t0;
      const tb = rev ? t0 : t1;
      const nSeg = edge.isClosed ? 16 : 8;
      for (let k = 0; k < nSeg; k += 1) {
        const u = ta + (tb - ta) * (k / nSeg);
        const pt = edge.pointAt(u);
        pts.push([Number(pt[0]), Number(pt[1]), Number(pt[2])]);
      }
    } catch {
      if (pStart) pts.push([Number(pStart[0]), Number(pStart[1]), Number(pStart[2])]);
    }
  }

  const dedup = [];
  for (const p of pts) {
    if (dedup.length === 0 || dist3(dedup[dedup.length - 1], p) > EPS_PT) dedup.push(p);
  }
  while (dedup.length >= 2 && dist3(dedup[dedup.length - 1], dedup[0]) <= EPS_PT) dedup.pop();
  return dedup;
}

function tessellatePlanarBrepFace(rhino, brep, bf, xf) {
  try {
    // rhino3dm.js requires explicit tolerance argument (no-arg passes NaN and returns true on spheres!)
    if (!bf.isPlanar(1e-4)) return null;
  } catch {
    return null;
  }

  const loops = bf.loops;
  if (!loops || loops.count < 1) return null;

  let outerPts = null;
  const innerLoops3d = [];
  const fallbackLoops = [];

  for (let li = 0; li < loops.count; li += 1) {
    const lp = loops.get(li);
    const pts = extractLoopPoints3d(brep, lp);
    if (pts.length < 3) continue;
    const ltName = enumName(rhino.BrepLoopType, lp.loopType);
    if (ltName === 'Outer' && !outerPts) outerPts = pts;
    else if (ltName === 'Inner') innerLoops3d.push(pts);
    else fallbackLoops.push(pts);
  }

  if (!outerPts) {
    if (fallbackLoops.length === 0) return null;
    fallbackLoops.sort((a, b) => {
      const na = newellNormal(a);
      const nb = newellNormal(b);
      return Math.hypot(nb[0], nb[1], nb[2]) - Math.hypot(na[0], na[1], na[2]);
    });
    outerPts = fallbackLoops[0];
    for (let i = 1; i < fallbackLoops.length; i += 1) innerLoops3d.push(fallbackLoops[i]);
  }

  let normal = [0, 0, 0];
  try {
    const du = bf.domain(0);
    const dv = bf.domain(1);
    const nRh = bf.normalAt(0.5 * (du[0] + du[1]), 0.5 * (dv[0] + dv[1]));
    normal = [Number(nRh[0]), Number(nRh[1]), Number(nRh[2])];
    if (bf.orientationIsReversed) normal = [-normal[0], -normal[1], -normal[2]];
  } catch {
    // fallback to Newell below
  }

  let nLen = Math.hypot(normal[0], normal[1], normal[2]);
  if (nLen <= 1e-9) {
    normal = newellNormal(outerPts);
    nLen = Math.hypot(normal[0], normal[1], normal[2]);
  }
  if (nLen <= 1e-9) return null;
  normal = [normal[0] / nLen, normal[1] / nLen, normal[2] / nLen];

  const origin = outerPts[0];
  const allPts = [...outerPts, ...innerLoops3d.flat()];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let maxDev = 0;
  for (const p of allPts) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[2] < minZ) minZ = p[2];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
    if (p[2] > maxZ) maxZ = p[2];
    const dev = Math.abs(
      (p[0] - origin[0]) * normal[0] + (p[1] - origin[1]) * normal[1] + (p[2] - origin[2]) * normal[2],
    );
    if (dev > maxDev) maxDev = dev;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  if (diag <= 1e-7 || maxDev > Math.max(1e-3, 1e-3 * diag)) return null;

  const ref = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = ref[1] * normal[2] - ref[2] * normal[1];
  let uy = ref[2] * normal[0] - ref[0] * normal[2];
  let uz = ref[0] * normal[1] - ref[1] * normal[0];
  const uLen = Math.hypot(ux, uy, uz);
  ux /= uLen;
  uy /= uLen;
  uz /= uLen;
  const vx = normal[1] * uz - normal[2] * uy;
  const vy = normal[2] * ux - normal[0] * uz;
  const vz = normal[0] * uy - normal[1] * ux;

  const proj = (list) =>
    list.map((p) => {
      const dx = p[0] - origin[0];
      const dy = p[1] - origin[1];
      const dz = p[2] - origin[2];
      return [dx * ux + dy * uy + dz * uz, dx * vx + dy * vy + dz * vz];
    });

  let outer2d = proj(outerPts);
  const outerArea = signedArea2d(outer2d);
  if (Math.abs(outerArea) <= EPS_AREA) return null;
  if (outerArea < 0) {
    outerPts = [...outerPts].reverse();
    outer2d = [...outer2d].reverse();
  }

  const pts3d = [...outerPts];
  const pts2d = [...outer2d];
  let ring = Array.from({ length: outerPts.length }, (_, i) => i);

  const validHoles = [];
  for (let h3 of innerLoops3d) {
    let h2 = proj(h3);
    const ha = signedArea2d(h2);
    if (Math.abs(ha) <= EPS_AREA) continue;
    if (ha > 0) {
      h3 = [...h3].reverse();
      h2 = [...h2].reverse();
    }
    let hMaxX = -Infinity;
    for (const p of h2) if (p[0] > hMaxX) hMaxX = p[0];
    validHoles.push({ maxX: hMaxX, h3, h2 });
  }
  validHoles.sort((a, b) => b.maxX - a.maxX);
  for (const h of validHoles) {
    const base = pts3d.length;
    pts3d.push(...h.h3);
    pts2d.push(...h.h2);
    const hRing = Array.from({ length: h.h3.length }, (_, i) => base + i);
    ring = mergeHoleIntoRing(ring, hRing, pts2d);
  }

  const tris = earClip2d(ring, pts2d);
  if (tris.length === 0) return null;

  const v = new Array(pts3d.length * 3);
  for (let i = 0; i < pts3d.length; i += 1) {
    const tp = applyXformPoint(pts3d[i], xf);
    v[i * 3] = tp[0];
    v[i * 3 + 1] = tp[1];
    v[i * 3 + 2] = tp[2];
  }
  const f = new Array(tris.length * 4);
  for (let i = 0; i < tris.length; i += 1) {
    const t = tris[i];
    f[i * 4] = t[0];
    f[i * 4 + 1] = t[1];
    f[i * 4 + 2] = t[2];
    f[i * 4 + 3] = t[2];
  }
  return { v, f };
}

function meshToArrays(mesh, xf) {
  if (!mesh) return null;
  const vl = mesh.vertices();
  const fl = mesh.faces();
  const nv = vl.count;
  const nf = fl.count;
  if (nv < 3 || nf < 1) return null;
  const v = new Array(nv * 3);
  for (let i = 0; i < nv; i += 1) {
    const p = vl.get(i);
    const x = p[0];
    const y = p[1];
    const z = p[2];
    if (xf === IDENTITY) {
      v[i * 3] = x;
      v[i * 3 + 1] = y;
      v[i * 3 + 2] = z;
    } else {
      const w = xf[12] * x + xf[13] * y + xf[14] * z + xf[15] || 1;
      v[i * 3] = (xf[0] * x + xf[1] * y + xf[2] * z + xf[3]) / w;
      v[i * 3 + 1] = (xf[4] * x + xf[5] * y + xf[6] * z + xf[7]) / w;
      v[i * 3 + 2] = (xf[8] * x + xf[9] * y + xf[10] * z + xf[11]) / w;
    }
  }
  const f = new Array(nf * 4);
  for (let i = 0; i < nf; i += 1) {
    const q = fl.get(i);
    f[i * 4] = q[0];
    f[i * 4 + 1] = q[1];
    f[i * 4 + 2] = q[2];
    f[i * 4 + 3] = q.length >= 4 ? q[3] : q[2];
  }
  return { v, f };
}

export function extract3dm(rhino, bytes) {
  const doc = rhino.File3dm.fromByteArray(bytes);
  if (!doc) throw new Error('Gagal membaca file Rhino .3dm.');
  const unitName = enumName(rhino.UnitSystem, doc.settings().modelUnitSystem);
  const out = {
    unit: UNIT_NAMES[unitName] || 'm',
    total_raw_objects: doc.objects().count,
    hidden_skipped: 0,
    missing_mesh: [],
    chunks: [],
  };

  const layers = doc.layers();
  const layerByIdx = new Map();
  const layerById = new Map();
  for (let i = 0; i < layers.count; i += 1) {
    const l = layers.get(i);
    layerByIdx.set(i, l);
    layerById.set(String(l.id), l);
  }
  const layerInfo = new Map();
  for (const [i, lyr] of layerByIdx) {
    const parts = [lyr.name || `Layer_${i}`];
    let vis = lyr.visible !== false;
    const rMat = Number.isInteger(lyr.renderMaterialIndex) ? lyr.renderMaterialIndex : -1;
    let cur = lyr;
    for (let d = 0; d < 10; d += 1) {
      const pid = String(cur.parentLayerId || ZERO_GUID);
      if (!pid || pid === ZERO_GUID || !layerById.has(pid)) break;
      cur = layerById.get(pid);
      parts.push(cur.name || '');
      vis = vis && cur.visible !== false;
    }
    const full = parts.filter(Boolean).reverse().join(' / ') || `Layer_${i}`;
    layerInfo.set(i, [full, vis, rMat]);
  }

  const mats = doc.materials();
  const matNames = new Map();
  const matTransp = new Map();
  for (let i = 0; i < mats.count; i += 1) {
    const m = mats.get(i);
    matNames.set(i, m.name || `Mat_${i}`);
    matTransp.set(i, Number(m.transparency || 0));
  }

  const idefs = doc.instanceDefinitions();
  const idefMap = new Map();
  for (let i = 0; i < idefs.count; i += 1) {
    const d = idefs.get(i);
    idefMap.set(String(d.id), d);
  }
  const objs = doc.objects();
  const objById = new Map();
  const objList = [];
  for (let i = 0; i < objs.count; i += 1) {
    const o = objs.get(i);
    objList.push(o);
    objById.set(String(o.attributes().id), o);
  }

  const missing = new Map();
  const missingObjs = new Map();
  const fallbackQueue = [];
  const MT = rhino.MeshType;
  const meshTypes = [MT.Any, MT.Render, MT.Default];
  const isMode = (attr, name) => enumName(rhino.ObjectMode, attr.mode) === name;
  const matSrc = (attr) => enumName(rhino.ObjectMaterialSource, attr.materialSource);

  const add = (g, layer, srcMat, mat, transp, arr) => {
    if (!arr || arr.v.length < 9 || arr.f.length < 4) return;
    out.chunks.push({ g, layer, src_mat: srcMat, mat, transp, v: arr.v, f: arr.f });
  };

  function proc(obj, xf, parentLayer, parentMat, depth) {
    if (depth > 8) return;
    let geom = obj.geometry();
    const attr = obj.attributes();
    const [lName, lVis, lMat] = layerInfo.get(attr.layerIndex) || ['Default', true, -1];
    if (attr.visible === false || isMode(attr, 'Hidden') || !lVis) {
      out.hidden_skipped += 1;
      return;
    }
    const own = (lName || '').trim();
    const layerName =
      own && !['default', 'by parent', 'byparent'].includes(own.toLowerCase()) ? own : parentLayer || own || 'Default';

    const src = matSrc(attr);
    let effMat;
    if (src === 'MaterialFromParent') effMat = parentMat >= 0 ? parentMat : lMat;
    else if (src === 'MaterialFromObject' && attr.materialIndex >= 0) effMat = attr.materialIndex;
    else if (attr.materialIndex >= 0) effMat = attr.materialIndex;
    else if (lMat >= 0) effMat = lMat;
    else effMat = parentMat;

    const matName = matNames.get(effMat) || '';
    const transp = matTransp.get(effMat) || 0;
    const objName = (attr.name || '').trim();
    let g;
    let srcMat;
    if (objName && objName.toLowerCase() !== layerName.toLowerCase()) {
      g = layerName === 'Default' ? objName : `${layerName} :: ${objName}`;
      srcMat = matName || objName;
    } else if (matName) {
      g = `${layerName} :: ${matName}`;
      srcMat = matName;
    } else {
      g = layerName;
      srcMat = 'Default';
    }

    if (geom instanceof rhino.InstanceReference) {
      const childXf = matMul4(xf, geom.xform.toFloatArray(true));
      const idef = idefMap.get(String(geom.parentIdefId));
      if (idef) {
        for (const cid of idef.getObjectIds()) {
          const child = objById.get(String(cid));
          if (child) proc(child, childXf, layerName, effMat, depth + 1);
        }
      }
      return;
    }
    if (geom instanceof rhino.Mesh) {
      add(g, layerName, srcMat, matName, transp, meshToArrays(geom, xf));
      return;
    }
    if (rhino.SubD && geom instanceof rhino.SubD) {
      try {
        const b = geom.toBrep();
        if (b) geom = b;
      } catch {
        return;
      }
    }
    if (geom instanceof rhino.Extrusion) {
      for (const t of meshTypes) {
        const m = geom.getMesh(t);
        if (m && m.faces().count > 0) {
          const arr = meshToArrays(m, xf);
          if (arr) {
            add(g, layerName, srcMat, matName, transp, arr);
            return;
          }
        }
      }
      const b = geom.toBrep(true);
      if (b) geom = b;
    }
    if (geom instanceof rhino.Brep) {
      const faces = geom.faces();
      const missingFaceIndices = [];
      for (let i = 0; i < faces.count; i += 1) {
        const bf = faces.get(i);
        let got = false;
        for (const t of meshTypes) {
          const m = bf.getMesh(t);
          if (m && m.faces().count > 0) {
            const arr = meshToArrays(m, xf);
            if (arr) {
              add(g, layerName, srcMat, matName, transp, arr);
              got = true;
              break;
            }
          }
        }
        if (!got) {
          missingFaceIndices.push(i);
        }
      }
      if (missingFaceIndices.length > 0) {
        const k = `${g}\u0000${layerName}\u0000Brep`;
        missing.set(k, (missing.get(k) || 0) + missingFaceIndices.length);
        missingObjs.set(k, (missingObjs.get(k) || 0) + 1);
        fallbackQueue.push({
          brep: geom,
          faceIndices: missingFaceIndices,
          g,
          layer: layerName,
          srcMat,
          mat: matName,
          transp,
          xf,
        });
      }
    } else if (geom instanceof rhino.Surface) {
      const k = `${g}\u0000${layerName}\u0000Surface`;
      missing.set(k, (missing.get(k) || 0) + 1);
      missingObjs.set(k, (missingObjs.get(k) || 0) + 1);
    }
  }

  for (const o of objList) {
    if (isMode(o.attributes(), 'InstanceDefinitionObject')) continue;
    proc(o, IDENTITY, null, -1, 0);
  }

  // A3-05 (Opsi 2): hanya jalankan tesselasi cadangan planar bila file 3DM menghasilkan 0 mesh sama sekali
  if (out.chunks.length === 0 && fallbackQueue.length > 0) {
    for (const k of [...missing.keys()]) {
      if (k.endsWith('\u0000Brep')) {
        missing.delete(k);
        missingObjs.delete(k);
      }
    }
    let planarFallbackFaces = 0;
    for (const item of fallbackQueue) {
      const faces = item.brep.faces();
      let failedForObj = 0;
      for (const fi of item.faceIndices) {
        const bf = faces.get(fi);
        const arr = tessellatePlanarBrepFace(rhino, item.brep, bf, item.xf);
        if (arr) {
          add(item.g, item.layer, item.srcMat, item.mat, item.transp, arr);
          planarFallbackFaces += 1;
        } else {
          failedForObj += 1;
        }
      }
      if (failedForObj > 0) {
        const k = `${item.g}\u0000${item.layer}\u0000Brep`;
        missing.set(k, (missing.get(k) || 0) + failedForObj);
        missingObjs.set(k, (missingObjs.get(k) || 0) + 1);
      }
    }
    out.planar_fallback_faces = planarFallbackFaces;
  }

  for (const [k, cnt] of [...missing.entries()].sort()) {
    const [group, layer, type] = k.split('\u0000');
    out.missing_mesh.push({
      group,
      layer,
      object_type: type,
      face_count: cnt,
      object_count: missingObjs.get(k) || 0,
      instruction:
        'Buka di Rhino, jalankan RefreshShade atau simpan ulang dari Rhino tanpa SaveSmall (viewport mode Shaded), atau jalankan perintah Mesh pada objek Brep/Surface sebelum menyimpan .3dm.',
    });
  }
  return out;
}
