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
          const k = `${g}\u0000${layerName}\u0000Brep`;
          missing.set(k, (missing.get(k) || 0) + 1);
        }
      }
    } else if (geom instanceof rhino.Surface) {
      const k = `${g}\u0000${layerName}\u0000Surface`;
      missing.set(k, (missing.get(k) || 0) + 1);
    }
  }

  for (const o of objList) {
    if (isMode(o.attributes(), 'InstanceDefinitionObject')) continue;
    proc(o, IDENTITY, null, -1, 0);
  }
  for (const [k, cnt] of [...missing.entries()].sort()) {
    const [group, layer, type] = k.split('\u0000');
    out.missing_mesh.push({
      group,
      layer,
      object_type: type,
      face_count: cnt,
      instruction:
        'Di Rhino: tampilkan viewport dalam mode Shaded lalu Save (jangan gunakan SaveSmall), atau jalankan perintah Mesh pada objek Brep/Surface sebelum menyimpan .3dm.',
    });
  }
  return out;
}
