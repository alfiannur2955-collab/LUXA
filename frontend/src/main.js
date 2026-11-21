import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Chart from 'chart.js/auto';
import { StagingWorkspaceController } from './stagingWorkspace.js';

// ============================================================================
// GLOBAL STATE — OTTV 3D PARAMETRIC STUDIO v5.0 (MULTI-ADAPTER STAGING)
// ============================================================================
let currentAnalysisData = null;
let currentPresetId = 'fasad_curtain_wall_baru';
let stagingController = null;

// v5.0 Intake & 3D Staging Persistence State
let currentSourceSoftware = 'archicad';
let currentZGroundCutoff = 0.0;
let faceCategoryOverrides = {};
let faceZBandOverrides = [];

let materialsCatalog = [];
let locationsCatalog = [];
let availableModelsCatalog = [];

// Stage 2 & Stage 4 Group / Orientation overrides
let disabledGroups = new Set();
let groupCategoryOverrides = {};
let groupMaterialMap = {};
let groupsToAutoSplit = new Set();
let groupWwrMap = {};
let orientationMaterialOverrides = {};

// Stage 3 Custom Floor Zones (Lobby / Podium / Tipikal)
let customFloorZones = [
  { name: 'Lobby Utama', floor_from: 1, floor_to: 2, height_m: 5.0 },
  { name: 'Podium Komersial', floor_from: 3, floor_to: 5, height_m: 4.2 },
  { name: 'Tipikal Kantor', floor_from: 6, floor_to: 24, height_m: 3.6 },
];

// Manual per-panel exclusion/inclusion overrides in current model
let manualPanelActiveMap = new Map();

// Selection & Inspection state
let lockedPanelId = null;
let hoveredPanelId = null;

// 8-Direction & Solar Exposure Filter state
// 'ALL' | 'U' | 'TL' | 'T' | 'TGR' | 'S' | 'BD' | 'B' | 'BL' | 'SUNLIT_HOUR'
let activeExposureDirection = 'ALL';

// Camera Projection & Orientation state
let cameraMode = 'perspective'; // 'perspective' | 'axonometric'
let currentNorthAngle = 0;      // 0..360 deg

// Table Pagination & Filter state
let filteredPanels = [];
let currentPage = 1;
const PAGE_SIZE = 12;

// Three.js Globals
let scene, camera, perspCamera, orthoCamera, renderer, controls, raycaster, mouse;
let orthoFrustumHalfH = 65;
let envelopeRootGroup;
let mergedPanelMesh = null;
let ghostPanelMesh = null;
let mergedWireframe = null;
let mergedFrameMesh = null;
let normalsLineSegments = null;
let sunDomeGroup = null;
let sectionCutGroup = null;
let selectedHighlightGroup = null;
let groundGridHelper = null;
let triToPanelIndex = [];

// Chart.js Globals
let radarChart = null;
let barChart = null;

// Rhino3dm WASM instance
let rhinoModule = null;

// Debounce timer
let analyzeDebounceTimer = null;

const ORIENTATION_META = {
  U:   { angle: 0,   name: 'Utara (North)' },
  TL:  { angle: 45,  name: 'Timur Laut (Northeast)' },
  T:   { angle: 90,  name: 'Timur (East)' },
  TGR: { angle: 135, name: 'Tenggara (Southeast)' },
  S:   { angle: 180, name: 'Selatan (South)' },
  BD:  { angle: 225, name: 'Barat Daya (Southwest)' },
  B:   { angle: 270, name: 'Barat (West)' },
  BL:  { angle: 315, name: 'Barat Laut (Northwest)' },
};

// ============================================================================
// 1. INITIALIZE RHINO3DM.JS WASM MODULE
// ============================================================================
async function initRhino3dmWasm() {
  const badge = document.getElementById('rhino3dm-wasm-status');
  try {
    const rhinoFactory = window.rhino3dm;
    if (typeof rhinoFactory !== 'function') {
      throw new Error('window.rhino3dm global script not loaded');
    }
    rhinoModule = await rhinoFactory();
    if (badge) {
      badge.textContent = 'rhino3dm.js Ready';
    }
  } catch (err) {
    console.warn('rhino3dm client fallback:', err);
    if (badge) {
      badge.textContent = 'Server Rhino Engine';
    }
  }
}

async function inspect3dmFileClientSide(file) {
  const metaBox = document.getElementById('rhino-client-metadata');
  if (!rhinoModule || !file.name.toLowerCase().endsWith('.3dm')) {
    metaBox?.classList.add('hidden');
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const doc = rhinoModule.File3dm.fromByteArray(new Uint8Array(buffer));
    if (!doc) return;
    const objects = doc.objects();
    const layers = doc.layers();
    let meshCount = 0;
    let brepCount = 0;
    for (let i = 0; i < objects.count; i++) {
      const geom = objects.get(i).geometry();
      const gType = geom.objectType;
      if (gType === rhinoModule.ObjectType.Mesh) meshCount++;
      else if (
        gType === rhinoModule.ObjectType.Brep ||
        gType === rhinoModule.ObjectType.Extrusion ||
        gType === rhinoModule.ObjectType.Surface
      ) {
        brepCount++;
      }
    }
    metaBox.innerHTML = `
      <div class="font-bold text-emerald-800 dark:text-emerald-300">Inspeksi Cepat rhino3dm.js:</div>
      <div>Objek 3D: <strong>${objects.count}</strong> (Mesh: ${meshCount}, NURBS/Brep: ${brepCount}) &middot; Layer: <strong>${layers.count}</strong></div>
    `;
    metaBox.classList.remove('hidden');
    doc.delete();
  } catch (e) {
    console.warn('Client 3dm inspect skipped:', e);
  }
}

// ============================================================================
// 2. THREE.JS HIGH-PERFORMANCE VIEWPORT (PERSPECTIVE <-> AXONOMETRIC)
// ============================================================================
function initThreeViewport() {
  const container = document.getElementById('three-viewport');
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 540;
  const aspect = width / height;

  scene = new THREE.Scene();
  const isDark = document.documentElement.classList.contains('dark');
  scene.background = new THREE.Color(isDark ? 0x070a12 : 0xf3f4ed);

  // Architectural Z-up convention
  THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

  perspCamera = new THREE.PerspectiveCamera(40, aspect, 0.5, 4500);
  perspCamera.up.set(0, 0, 1);
  perspCamera.position.set(78, -96, 68);

  orthoFrustumHalfH = 65;
  orthoCamera = new THREE.OrthographicCamera(
    -orthoFrustumHalfH * aspect,
    orthoFrustumHalfH * aspect,
    orthoFrustumHalfH,
    -orthoFrustumHalfH,
    -2500,
    4500
  );
  orthoCamera.up.set(0, 0, 1);
  orthoCamera.position.copy(perspCamera.position);

  camera = perspCamera;

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.innerHTML = '';
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.75;
  controls.zoomSpeed = 1.1;
  controls.panSpeed = 0.8;
  controls.target.set(0, 0, 42);
  controls.update();

  // Architectural balanced 3-point lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.86);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xfffbeb, 0.68);
  sunLight.position.set(-90, -80, 150);
  scene.add(sunLight);

  const fillLight = new THREE.DirectionalLight(0xe0f2fe, 0.38);
  fillLight.position.set(90, 95, 65);
  scene.add(fillLight);

  buildGroundGrid(isDark);

  envelopeRootGroup = new THREE.Group();
  selectedHighlightGroup = new THREE.Group();
  scene.add(envelopeRootGroup);
  scene.add(selectedHighlightGroup);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  let downPos = { x: 0, y: 0 };
  renderer.domElement.addEventListener('pointerdown', (e) => {
    downPos = { x: e.clientX, y: e.clientY };
  });

  renderer.domElement.addEventListener('pointermove', onViewportPointerMove);

  renderer.domElement.addEventListener('pointerup', (e) => {
    const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    if (dist < 5) {
      onViewportClick(e);
    }
  });

  window.addEventListener('resize', updateCameraAspectOnResize);

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    updateHudCompassDial();
    renderer.render(scene, camera);
  }
  animate();
}

function updateCameraAspectOnResize() {
  const container = document.getElementById('three-viewport');
  if (!container || !renderer) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w <= 0 || h <= 0) return;
  const aspect = w / h;

  perspCamera.aspect = aspect;
  perspCamera.updateProjectionMatrix();

  orthoCamera.left = -orthoFrustumHalfH * aspect;
  orthoCamera.right = orthoFrustumHalfH * aspect;
  orthoCamera.top = orthoFrustumHalfH;
  orthoCamera.bottom = -orthoFrustumHalfH;
  orthoCamera.updateProjectionMatrix();

  renderer.setSize(w, h);
}

function setCameraProjectionMode(mode) {
  if (mode === cameraMode) return;
  const container = document.getElementById('three-viewport');
  const aspect = container ? (container.clientWidth || 800) / (container.clientHeight || 540) : 1.48;

  if (mode === 'axonometric') {
    const dist = perspCamera.position.distanceTo(controls.target);
    orthoFrustumHalfH = Math.max(18, dist * Math.tan(THREE.MathUtils.degToRad(perspCamera.fov * 0.5)));
    orthoCamera.left = -orthoFrustumHalfH * aspect;
    orthoCamera.right = orthoFrustumHalfH * aspect;
    orthoCamera.top = orthoFrustumHalfH;
    orthoCamera.bottom = -orthoFrustumHalfH;
    orthoCamera.zoom = 1.0;
    orthoCamera.position.copy(perspCamera.position);
    orthoCamera.up.set(0, 0, 1);
    orthoCamera.lookAt(controls.target);
    orthoCamera.updateProjectionMatrix();
    camera = orthoCamera;
  } else {
    const effHalfH = orthoFrustumHalfH / Math.max(0.15, orthoCamera.zoom);
    const newDist = effHalfH / Math.tan(THREE.MathUtils.degToRad(perspCamera.fov * 0.5));
    const dir = orthoCamera.position.clone().sub(controls.target).normalize();
    perspCamera.position.copy(controls.target).addScaledVector(dir, newDist);
    perspCamera.up.set(0, 0, 1);
    perspCamera.lookAt(controls.target);
    perspCamera.updateProjectionMatrix();
    camera = perspCamera;
  }

  cameraMode = mode;
  controls.object = camera;
  controls.update();

  // Update button UI state
  const btnPersp = document.getElementById('btn-cam-persp');
  const btnAxon = document.getElementById('btn-cam-axon');
  if (btnPersp && btnAxon) {
    if (mode === 'perspective') {
      btnPersp.className = 'px-2.5 py-1 rounded-lg bg-emerald-800 text-white font-semibold transition';
      btnAxon.className = 'px-2.5 py-1 rounded-lg hover:opacity-80 transition';
    } else {
      btnAxon.className = 'px-2.5 py-1 rounded-lg bg-emerald-800 text-white font-semibold transition';
      btnPersp.className = 'px-2.5 py-1 rounded-lg hover:opacity-80 transition';
    }
  }
  updateViewportActiveBadge();
}

function updateHudCompassDial() {
  const dial = document.getElementById('hud-compass-dial');
  if (!dial || !camera || !controls) return;
  const dx = controls.target.x - camera.position.x;
  const dy = controls.target.y - camera.position.y;
  const camHeadingDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
  const relNorthDeg = currentNorthAngle - camHeadingDeg;
  dial.style.transform = `rotate(${relNorthDeg.toFixed(1)}deg)`;
}

function buildGroundGrid(isDark) {
  if (groundGridHelper) {
    scene.remove(groundGridHelper);
    groundGridHelper.dispose?.();
  }
  const gridColor1 = isDark ? 0x1e293b : 0xd6d9ce;
  const gridColor2 = isDark ? 0x0f172a : 0xe3e6dc;
  groundGridHelper = new THREE.GridHelper(240, 40, gridColor1, gridColor2);
  groundGridHelper.rotation.x = Math.PI / 2;
  groundGridHelper.position.z = -0.08;
  scene.add(groundGridHelper);
}

// ============================================================================
// 3. COLOR MODES & HEATMAP SUB-MODES (SMOOTH COMPOSITE VS ELEMENT VS SOLAR)
// ============================================================================
function evaluateThermalGradientRGB(valWm2, minVal = 0.0, maxVal = 65.0) {
  const stops = [
    [0.0,  [0.063, 0.725, 0.506]], // #10b981 Emerald
    [18.0, [0.133, 0.773, 0.369]], // #22c55e Green
    [28.0, [0.518, 0.800, 0.086]], // #84cc16 Lime-Amber
    [32.0, [0.918, 0.702, 0.031]], // #eab308 Amber-Yellow
    [35.0, [0.961, 0.620, 0.043]], // #f59e0b SNI Threshold (35 W/m2)
    [45.0, [0.937, 0.267, 0.267]], // #ef4444 Red
    [65.0, [0.725, 0.110, 0.110]], // #b91c1c Deep Crimson
  ];
  const v = Math.max(minVal, Math.min(maxVal, Number(valWm2) || 0));
  for (let i = 0; i < stops.length - 1; i++) {
    const [v0, c0] = stops[i];
    const [v1, c1] = stops[i + 1];
    if (v <= v1) {
      const t = v1 === v0 ? 0 : (v - v0) / (v1 - v0);
      return [
        c0[0] + t * (c1[0] - c0[0]),
        c0[1] + t * (c1[1] - c0[1]),
        c0[2] + t * (c1[2] - c0[2]),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

function getPanelColorRGB(panel, colorMode, maxFloor = 24, heatmapSubmode = 'composite') {
  if (colorMode === 'orientation') {
    const az = ((panel.azimuth_deg % 360) + 360) % 360;
    const rad = (az * Math.PI) / 180;
    const r = 0.80 + 0.14 * Math.sin(rad + 0.4);
    const g = 0.78 + 0.14 * Math.cos(rad - 1.2);
    const b = 0.76 + 0.15 * Math.cos(rad + 0.5);
    return [
      Math.min(0.96, Math.max(0.55, r)),
      Math.min(0.95, Math.max(0.55, g)),
      Math.min(0.95, Math.max(0.55, b)),
    ];
  }

  if (colorMode === 'ottv') {
    if (heatmapSubmode === 'element') {
      const rgb = panel.heatmap_element_rgb || panel.heatmap_rgb || evaluateThermalGradientRGB(panel.ottv_panel_wm2);
      return rgb[0] > 1.0 ? [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255] : [rgb[0], rgb[1], rgb[2]];
    }
    if (heatmapSubmode === 'solar') {
      const solVal = panel.solar_exposure_wm2 ?? (panel.sf_wm2 * panel.sc_effective);
      return evaluateThermalGradientRGB(solVal * 0.85);
    }
    // Default: Smooth Facade Composite ('composite')
    const compVal = panel.ottv_composite_wm2 ?? panel.ottv_panel_wm2;
    return evaluateThermalGradientRGB(compVal);
  }

  if (colorMode === 'category') {
    const gName = (panel.group_name || '').toLowerCase();
    if (gName.includes('crown')) return [0.22, 0.72, 0.68];
    if (panel.element_type === 'glazing') return [0.58, 0.78, 0.92];
    return [0.85, 0.68, 0.52];
  }

  if (colorMode === 'floor') {
    const ratio = Math.min(1, Math.max(0, ((panel.floor_number || 1) - 1) / Math.max(1, maxFloor - 1)));
    return [
      0.35 + 0.55 * ratio,
      0.75 - 0.15 * ratio,
      0.62 - 0.30 * ratio,
    ];
  }

  if (colorMode === 'shading') {
    const sf = panel.shaded_fraction || 0;
    return [
      0.92 - 0.60 * sf,
      0.82 - 0.10 * sf,
      0.38 + 0.48 * sf,
    ];
  }

  return [0.75, 0.82, 0.75];
}

function updateLegendCaption(colorMode, heatmapSubmode = 'composite') {
  const caption = document.getElementById('viewport-legend-caption');
  const grad = document.getElementById('viewport-legend-gradient');
  const minLbl = document.getElementById('legend-min-label');
  const maxLbl = document.getElementById('legend-max-label');
  const subSel = document.getElementById('select-heatmap-submode');
  if (subSel) {
    subSel.style.display = colorMode === 'ottv' ? 'inline-block' : 'none';
  }
  if (!caption || !grad) return;

  if (colorMode === 'orientation') {
    caption.textContent = 'Warna menurut azimut kompas (0°–360°)';
    if (minLbl) minLbl.textContent = 'U (0°)';
    if (maxLbl) maxLbl.textContent = 'B (270°)';
    grad.className = 'w-28 h-2.5 rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-rose-400';
  } else if (colorMode === 'ottv') {
    if (heatmapSubmode === 'element') {
      caption.textContent = 'Heatmap Per Elemen Murni (Hijau: Spandrel -> Merah: Kaca Vision)';
      if (minLbl) minLbl.textContent = '3.9 W/m²';
      if (maxLbl) maxLbl.textContent = '45+ W/m²';
    } else if (heatmapSubmode === 'solar') {
      caption.textContent = 'Intensitas Radiasi Surya Transmisi (SF × SC_eff)';
      if (minLbl) minLbl.textContent = '15 W/m²';
      if (maxLbl) maxLbl.textContent = '65+ W/m²';
    } else {
      caption.textContent = 'Heatmap Komposit Fasad Halus (Interpolasi Vertex · Batas 35 W/m²)';
      if (minLbl) minLbl.textContent = '14 W/m²';
      if (maxLbl) maxLbl.textContent = '42+ W/m²';
    }
    grad.className = 'w-28 h-2.5 rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-600';
  } else if (colorMode === 'category') {
    caption.textContent = 'Biru: Kaca Vision · Coklat: Spandrel · Toska: Crown';
    if (minLbl) minLbl.textContent = 'Kaca';
    if (maxLbl) maxLbl.textContent = 'Spandrel';
    grad.className = 'w-28 h-2.5 rounded-full bg-gradient-to-r from-sky-400 via-amber-500 to-teal-500';
  } else if (colorMode === 'floor') {
    caption.textContent = 'Elevasi Lantai (L1 Bawah -> Lantai Puncak)';
    if (minLbl) minLbl.textContent = 'L1';
    if (maxLbl) maxLbl.textContent = 'L24';
    grad.className = 'w-28 h-2.5 rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-amber-500';
  } else if (colorMode === 'shading') {
    caption.textContent = 'Faktor Peneduh Raycast (Kuning: Terpapar -> Biru: Teduh)';
    if (minLbl) minLbl.textContent = 'Terpapar';
    if (maxLbl) maxLbl.textContent = 'Teduh';
    grad.className = 'w-28 h-2.5 rounded-full bg-gradient-to-r from-amber-300 via-emerald-400 to-sky-600';
  }
  updateViewportActiveBadge();
}

function updateViewportActiveBadge() {
  const badge = document.getElementById('viewport-active-badge');
  if (!badge) return;
  const camLabel = cameraMode === 'axonometric' ? 'Aksonometri (Orthographic)' : 'Perspektif 3D';
  const colorMode = document.getElementById('select-color-mode')?.value || 'ottv';
  const subMode = document.getElementById('select-heatmap-submode')?.value || 'composite';
  let modeTxt = 'Orientasi Kompas';
  if (colorMode === 'ottv') {
    modeTxt =
      subMode === 'composite'
        ? 'Heatmap Komposit Halus'
        : subMode === 'element'
        ? 'Heatmap Elemen (Kaca vs Spandrel)'
        : 'Radiasi Surya (SF×SC)';
  } else if (colorMode === 'category') modeTxt = 'Kategori Kelompok';
  else if (colorMode === 'floor') modeTxt = 'Elevasi Lantai';
  else if (colorMode === 'shading') modeTxt = 'Faktor Bayangan';

  const dirTxt = activeExposureDirection === 'ALL' ? '8 Arah' : `Sorot: ${activeExposureDirection}`;
  badge.textContent = `${camLabel} · ${modeTxt} · ${dirTxt} · Utara ${currentNorthAngle}°`;
}

// ============================================================================
// 4. 8-DIRECTION & SOLAR HOUR EXPOSURE MATCHING
// ============================================================================
function isPanelMatchingExposure(panel) {
  if (activeExposureDirection === 'ALL') return true;
  if (activeExposureDirection === 'SUNLIT_HOUR') {
    const hourVal = document.getElementById('select-solar-hour')?.value || 'all';
    const mask = Number(panel.sunlit_mask || 0);
    if (hourVal === 'all') return mask > 0;
    const h = parseInt(hourVal, 10);
    if (h >= 8 && h <= 16) {
      return (mask & (1 << (h - 8))) !== 0;
    }
    return mask > 0;
  }
  return panel.orientation_code === activeExposureDirection;
}

function updateExposureBannerAndMetrics() {
  const banner = document.getElementById('exposure-summary-banner');
  const metricsEl = document.getElementById('exposure-summary-metrics');
  if (!banner || !currentAnalysisData) return;

  const panels = currentAnalysisData.panels || [];
  const minFloor = parseInt(document.getElementById('slider-floor-min')?.value || '1', 10);
  const maxFloor = parseInt(document.getElementById('slider-floor-max')?.value || '999', 10);

  let matchedCount = 0;
  let matchedArea = 0;
  let matchedGlz = 0;
  let matchedHeatW = 0;
  let sumSfArea = 0;

  for (const p of panels) {
    if (p.floor_number < minFloor || p.floor_number > maxFloor) continue;
    if (!isPanelActive(p)) continue;
    if (!isPanelMatchingExposure(p)) continue;
    matchedCount++;
    matchedArea += p.area_m2;
    if (p.element_type === 'glazing') matchedGlz += p.area_m2;
    matchedHeatW += p.heat_gain_w;
    sumSfArea += p.sf_wm2 * p.area_m2;
  }

  const avgOttv = matchedArea > 0 ? matchedHeatW / matchedArea : 0;
  const avgWwr = matchedArea > 0 ? (matchedGlz / matchedArea) * 100 : 0;
  const avgSf = matchedArea > 0 ? sumSfArea / matchedArea : 0;

  const firstSpan = banner.querySelector('span:first-child');
  if (activeExposureDirection === 'ALL') {
    if (firstSpan) {
      firstSpan.innerHTML = `Menampilkan <strong>Seluruh 8 Arah Kompas (${matchedCount.toLocaleString('id-ID')} bidang aktif)</strong> &middot; Klik salah satu arah di atas untuk menyorot bidang terpapar.`;
    }
  } else if (activeExposureDirection === 'SUNLIT_HOUR') {
    const hourVal = document.getElementById('select-solar-hour')?.value || 'all';
    const hTxt = hourVal === 'all' ? 'Jam 08:00–16:00' : `Jam ${hourVal.padStart(2, '0')}:00`;
    if (firstSpan) {
      firstSpan.innerHTML = `Sorot <strong>Bidang Terpapar Sinar Matahari Langsung (${hTxt})</strong>: <strong>${matchedCount.toLocaleString('id-ID')} bidang</strong> (${matchedArea.toFixed(1)} m²)`;
    }
  } else {
    const meta = ORIENTATION_META[activeExposureDirection] || { angle: 0, name: activeExposureDirection };
    if (firstSpan) {
      firstSpan.innerHTML = `Sorot Arah <strong>${activeExposureDirection} — ${meta.name} (${meta.angle}°)</strong>: <strong>${matchedCount.toLocaleString('id-ID')} bidang</strong> &middot; Luas <strong>${matchedArea.toFixed(1)} m²</strong> &middot; WWR <strong>${avgWwr.toFixed(1)}%</strong>`;
    }
  }

  if (metricsEl) {
    metricsEl.textContent = `SF Rata: ${avgSf.toFixed(1)} W/m² · OTTV Seleksi: ${avgOttv.toFixed(2)} W/m²`;
  }
}

// ============================================================================
// 5. CREATE TEXT SPRITES FOR 3D COMPASS ROSE & SOLAR DOME LABELS
// ============================================================================
function createTextSprite(text, bgColor = 'rgba(15, 23, 42, 0.85)', textColor = '#ffffff', scaleSize = 6.5) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 64, 18);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.font = 'bold 28px "JetBrains Mono", monospace';
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 41);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scaleSize * 2.2, scaleSize * 0.7, 1);
  return sprite;
}

// ============================================================================
// 6. BUILD 3D COMPASS ROSE & PROPORTIONAL 3D SUN-PATH DOME (KUBAH MATAHARI)
// ============================================================================
function buildCompassAndSunDome(showSunDome) {
  const group = new THREE.Group();
  if (!currentAnalysisData) return group;

  const bbox = currentAnalysisData.summary?.bounding_box || {
    min: [-19, -14, 0],
    max: [19, 14, 86.4],
    center: [0, 0, 43.2],
    span: [38, 28, 86.4],
    horiz_radius: 23.6,
    recommended_dome_radius: 96.8,
  };

  const cx = bbox.center[0];
  const cy = bbox.center[1];
  const zBase = bbox.min[2];
  const horizR = Math.max(12, bbox.horiz_radius || 23.6);
  const baseDomeR = Math.max(28, bbox.recommended_dome_radius || 96.8);

  const domeScale = parseFloat(document.getElementById('slider-dome-radius')?.value || '1.05');
  const domeR = baseDomeR * domeScale;
  const compassR = Math.max(horizR * 1.45, domeR * 0.86);

  const radiusLabel = document.getElementById('val-dome-radius');
  if (radiusLabel) {
    radiusLabel.textContent = `${domeScale.toFixed(2)}× (${Math.round(domeR)}m)`;
  }

  const isDark = document.documentElement.classList.contains('dark');
  const northRad = THREE.MathUtils.degToRad(currentNorthAngle);

  // --- A. 3D GROUND COMPASS ROSE RING (Always visible around building base) ---
  const ringSegments = 128;
  const outerRingPts = [];
  const innerRingPts = [];
  for (let i = 0; i <= ringSegments; i++) {
    const theta = (i / ringSegments) * Math.PI * 2;
    outerRingPts.push(new THREE.Vector3(cx + Math.sin(theta) * compassR, cy + Math.cos(theta) * compassR, zBase + 0.12));
    innerRingPts.push(new THREE.Vector3(cx + Math.sin(theta) * (compassR * 0.91), cy + Math.cos(theta) * (compassR * 0.91), zBase + 0.12));
  }
  const ringMat = new THREE.LineBasicMaterial({
    color: isDark ? 0x38bdf8 : 0x0f766e,
    transparent: true,
    opacity: 0.65,
  });
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outerRingPts), ringMat));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(innerRingPts), ringMat));

  // Degree tick marks & 8 Compass Direction Labels rotated by currentNorthAngle
  const tickPos = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const worldRad = THREE.MathUtils.degToRad(deg) + northRad;
    const isMajor = deg % 45 === 0;
    const r0 = compassR * (isMajor ? 0.86 : 0.91);
    const r1 = compassR;
    tickPos.push(
      cx + Math.sin(worldRad) * r0, cy + Math.cos(worldRad) * r0, zBase + 0.14,
      cx + Math.sin(worldRad) * r1, cy + Math.cos(worldRad) * r1, zBase + 0.14
    );
  }
  const tickGeom = new THREE.BufferGeometry();
  tickGeom.setAttribute('position', new THREE.Float32BufferAttribute(tickPos, 3));
  group.add(new THREE.LineSegments(tickGeom, ringMat));

  // 8 Cardinal / Ordinal Badges on Ground Compass
  const compassDirs = [
    { code: 'U',   deg: 0,   bg: 'rgba(185, 28, 28, 0.92)' },
    { code: 'TL',  deg: 45,  bg: 'rgba(15, 118, 110, 0.85)' },
    { code: 'T',   deg: 90,  bg: 'rgba(15, 23, 42, 0.85)' },
    { code: 'TG',  deg: 135, bg: 'rgba(15, 118, 110, 0.85)' },
    { code: 'S',   deg: 180, bg: 'rgba(15, 23, 42, 0.85)' },
    { code: 'BD',  deg: 225, bg: 'rgba(180, 83, 9, 0.88)' },
    { code: 'B',   deg: 270, bg: 'rgba(185, 28, 28, 0.88)' },
    { code: 'BL',  deg: 315, bg: 'rgba(180, 83, 9, 0.88)' },
  ];
  const spriteScale = Math.max(4.2, compassR * 0.085);
  for (const cd of compassDirs) {
    const wRad = THREE.MathUtils.degToRad(cd.deg) + northRad;
    const lblR = compassR * 1.09;
    const sp = createTextSprite(`${cd.code} ${cd.deg}°`, cd.bg, '#ffffff', spriteScale);
    sp.position.set(cx + Math.sin(wRad) * lblR, cy + Math.cos(wRad) * lblR, zBase + 1.8);
    group.add(sp);
  }

  // North Pointer Arrow on Ground
  const nOrigin = new THREE.Vector3(cx, cy, zBase + 0.2);
  const nDir = new THREE.Vector3(Math.sin(northRad), Math.cos(northRad), 0).normalize();
  const northArrow = new THREE.ArrowHelper(nDir, nOrigin, compassR * 1.02, 0xdc2626, compassR * 0.10, compassR * 0.05);
  group.add(northArrow);

  if (!showSunDome) return group;

  // --- B. PROPORTIONAL 3D SUN-PATH DOME HEMISPHERE (KUBAH MATAHARI) ---
  const domeWireMat = new THREE.LineBasicMaterial({
    color: isDark ? 0xfbbf24 : 0xd97706,
    transparent: true,
    opacity: isDark ? 0.30 : 0.34,
  });

  // 1. Latitude (Altitude) rings at 0°, 20°, 40°, 60°, 78°
  for (const altDeg of [0, 20, 40, 60, 78]) {
    const altRad = THREE.MathUtils.degToRad(altDeg);
    const ringR = domeR * Math.cos(altRad);
    const ringZ = zBase + domeR * Math.sin(altRad);
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(cx + Math.sin(a) * ringR, cy + Math.cos(a) * ringR, ringZ));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), domeWireMat));
  }

  // 2. Azimuth Meridian Arcs every 45° from base up to zenith
  for (let azDeg = 0; azDeg < 360; azDeg += 45) {
    const azRad = THREE.MathUtils.degToRad(azDeg) + northRad;
    const arcPts = [];
    for (let s = 0; s <= 32; s++) {
      const altRad = (s / 32) * (Math.PI / 2);
      const rHoriz = domeR * Math.cos(altRad);
      const zVal = zBase + domeR * Math.sin(altRad);
      arcPts.push(new THREE.Vector3(cx + Math.sin(azRad) * rHoriz, cy + Math.cos(azRad) * rHoriz, zVal));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcPts), domeWireMat));
  }

  // 3. Diurnal Solar Trajectory Arc (08:00 - 16:00) & Sun Spheres + Exterior Solar Rays
  const solarVectors = currentAnalysisData.solar_vectors || [];
  const selectedHourStr = document.getElementById('select-solar-hour')?.value || 'all';
  const sunPathPoints = [];

  for (const sv of solarVectors) {
    const [sx, sy, sz] = sv.vector;
    const sunPos = new THREE.Vector3(cx + sx * domeR, cy + sy * domeR, zBase + sz * domeR);
    sunPathPoints.push(sunPos);

    const isSelectedHour = selectedHourStr === 'all' || parseInt(selectedHourStr, 10) === sv.hour;
    const isFocusedSingleHour = selectedHourStr !== 'all' && parseInt(selectedHourStr, 10) === sv.hour;

    // Sun sphere at each hour on the dome
    const sphereRadius = isFocusedSingleHour
      ? domeR * 0.036
      : isSelectedHour
      ? domeR * 0.022
      : domeR * 0.011;
    const sunGeom = new THREE.SphereGeometry(sphereRadius, 20, 20);
    const sunMat = new THREE.MeshBasicMaterial({
      color: isSelectedHour ? 0xf59e0b : 0x94a3b8,
      transparent: !isSelectedHour,
      opacity: isSelectedHour ? 1.0 : 0.45,
    });
    const sunMesh = new THREE.Mesh(sunGeom, sunMat);
    sunMesh.position.copy(sunPos);
    group.add(sunMesh);

    if (isFocusedSingleHour || (selectedHourStr === 'all' && sv.hour === 12)) {
      const haloGeom = new THREE.SphereGeometry(sphereRadius * 1.9, 20, 20);
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0xfde047,
        transparent: true,
        opacity: 0.32,
      });
      const haloMesh = new THREE.Mesh(haloGeom, haloMat);
      haloMesh.position.copy(sunPos);
      group.add(haloMesh);
    }

    // Time label sprite on dome
    if (isFocusedSingleHour || (selectedHourStr === 'all' && sv.hour % 2 === 0)) {
      const lblTxt = isFocusedSingleHour ? `${sv.time_label} (${sv.altitude_deg.toFixed(0)}°)` : sv.time_label;
      const lblSprite = createTextSprite(lblTxt, 'rgba(217, 119, 6, 0.92)', '#ffffff', spriteScale * 0.85);
      lblSprite.position.set(sunPos.x, sunPos.y, sunPos.z + domeR * 0.055);
      group.add(lblSprite);
    }

    // Solar Ray Arrows pointing from the outer Sun Dome toward the building facade perimeter
    // (Never spawning inside the building core!)
    if (isSelectedHour) {
      const rayDir = new THREE.Vector3(-sx, -sy, -sz).normalize();
      const mainRayLen = domeR * 0.34;
      const headLen = Math.max(2.2, domeR * 0.045);
      const headWidth = Math.max(1.2, domeR * 0.024);
      const mainArrow = new THREE.ArrowHelper(
        rayDir,
        sunPos,
        mainRayLen,
        isFocusedSingleHour ? 0xea580c : 0xf59e0b,
        headLen,
        headWidth
      );
      group.add(mainArrow);

      // If single hour is selected, also show a fan of parallel solar rays hitting the facade
      if (isFocusedSingleHour) {
        const perp = new THREE.Vector3(-sy, sx, 0).normalize();
        for (const offsetMult of [-0.55, 0.55]) {
          for (const zFrac of [0.30, 0.68]) {
            const targetPt = new THREE.Vector3(
              cx + sx * horizR + perp.x * horizR * offsetMult,
              cy + sy * horizR + perp.y * horizR * offsetMult,
              zBase + (bbox.span[2] || 60) * zFrac
            );
            const rayStart = targetPt.clone().addScaledVector(rayDir, -domeR * 0.38);
            const subArrow = new THREE.ArrowHelper(
              rayDir,
              rayStart,
              domeR * 0.36,
              0xfbbf24,
              headLen * 0.8,
              headWidth * 0.8
            );
            group.add(subArrow);
          }
        }
      }
    }
  }

  // Smooth curve connecting 08:00..16:00 sun positions
  if (sunPathPoints.length >= 2) {
    const curve = new THREE.CatmullRomCurve3(sunPathPoints);
    const tubeGeom = new THREE.TubeGeometry(curve, 64, Math.max(0.28, domeR * 0.0045), 8, false);
    const tubeMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    group.add(new THREE.Mesh(tubeGeom, tubeMat));
  }

  return group;
}

// ============================================================================
// 7. BUILD 3D HORIZONTAL FLOOR SECTION CUT PLANES
// ============================================================================
function getFloorZBounds(minFloor, maxFloor, floorHeightFallback = 3.6) {
  const floors = currentAnalysisData?.floor_breakdown || [];
  const zBase = currentAnalysisData?.summary?.z_min_m ?? 0;
  const fLow = floors.find((f) => f.floor_number === minFloor);
  const fHigh = floors.find((f) => f.floor_number === maxFloor);
  const zLow = fLow ? fLow.z_min : zBase + (minFloor - 1) * floorHeightFallback;
  const zHigh = fHigh ? fHigh.z_max : zBase + maxFloor * floorHeightFallback;
  return { zLow, zHigh };
}

function buildFloorSectionCutPlanes(minFloor, maxFloor, totalFloors, floorHeight) {
  const group = new THREE.Group();
  const showPlane = document.getElementById('chk-show-section-plane')?.checked ?? true;
  if (!showPlane || !currentAnalysisData) return group;
  if (minFloor <= 1 && maxFloor >= totalFloors) return group;

  const bbox = currentAnalysisData.summary?.bounding_box || {
    center: [0, 0, 43],
    min: [-20, -15, 0],
    horiz_radius: 24,
  };
  const cx = bbox.center[0];
  const cy = bbox.center[1];
  const rCut = Math.max(16, (bbox.horiz_radius || 24) * 1.22);
  const { zLow, zHigh } = getFloorZBounds(minFloor, maxFloor, floorHeight);

  const cutLevels = [];
  if (minFloor > 1) cutLevels.push({ z: zLow, label: `Potongan Bawah L${minFloor}` });
  if (maxFloor < totalFloors) cutLevels.push({ z: zHigh, label: `Potongan Atas L${maxFloor}` });

  for (const cl of cutLevels) {
    const ringGeom = new THREE.RingGeometry(rCut * 0.82, rCut, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.32,
    });
    const ringMesh = new THREE.Mesh(ringGeom, ringMat);
    ringMesh.position.set(cx, cy, cl.z);
    group.add(ringMesh);

    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pts.push(new THREE.Vector3(cx + Math.cos(a) * rCut, cy + Math.sin(a) * rCut, cl.z));
    }
    const lineMat = new THREE.LineBasicMaterial({ color: 0x059669 });
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  }

  return group;
}

// ============================================================================
// 8. BUILD MERGED 3D SCENE (WITH SMOOTH VERTEX COLOR INTERPOLATION & 8-DIR)
// ============================================================================
function rebuild3DScene(resetCamera = false) {
  if (!currentAnalysisData || !envelopeRootGroup) return;

  // Clear previous meshes cleanly
  while (envelopeRootGroup.children.length > 0) {
    const child = envelopeRootGroup.children[0];
    child.traverse?.((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    envelopeRootGroup.remove(child);
  }

  triToPanelIndex = [];
  const panels = currentAnalysisData.panels || [];
  const outerOnly = document.getElementById('chk-outer-skin-only')?.checked ?? true;
  const showFrames = document.getElementById('chk-show-frames')?.checked ?? true;
  const showWireframe = document.getElementById('chk-show-wireframe')?.checked ?? true;
  const showNormals = document.getElementById('chk-show-normals')?.checked ?? false;
  const showRays = document.getElementById('chk-show-rays')?.checked ?? true;
  const colorMode = document.getElementById('select-color-mode')?.value || 'ottv';
  const heatmapSubmode = document.getElementById('select-heatmap-submode')?.value || 'composite';
  const isolateExposureOnly = document.getElementById('chk-exposure-isolate')?.checked ?? false;

  updateLegendCaption(colorMode, heatmapSubmode);
  updateExposureBannerAndMetrics();

  const minFloor = parseInt(document.getElementById('slider-floor-min')?.value || '1', 10);
  const maxFloor = parseInt(document.getElementById('slider-floor-max')?.value || '999', 10);
  const totalFloors = currentAnalysisData.summary?.total_floors || 24;
  const floorHeight = parseFloat(document.getElementById('input-floor-height')?.value || '3.6');
  const { zLow, zHigh } = getFloorZBounds(minFloor, maxFloor, floorHeight);
  const zMinClip = zLow - 0.25;
  const zMaxClip = zHigh + 0.5;

  // Determine whether to apply 3D Spatial Vertex Color Interpolation (Gouraud smoothing)
  // so curved facade heatmaps and orientation gradients have zero facet/spandrel banding
  const useSmoothVertexColors =
    (colorMode === 'ottv' && (heatmapSubmode === 'composite' || heatmapSubmode === 'solar')) ||
    colorMode === 'orientation';

  const vertexColorAccumulator = new Map();
  const vKey = (v) => `${Math.round(v[0] * 10)},${Math.round(v[1] * 10)},${Math.round(v[2] * 10)}`;

  if (useSmoothVertexColors) {
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      if (outerOnly && !p.is_outer) continue;
      if (p.floor_number < minFloor || p.floor_number > maxFloor) continue;
      if (disabledGroups.has(p.group_name)) continue;
      const verts = p.vertices;
      if (!verts || verts.length < 3) continue;

      const [cr, cg, cb] = getPanelColorRGB(p, colorMode, totalFloors, heatmapSubmode);
      for (let k = 0; k < verts.length; k++) {
        const key = vKey(verts[k]);
        let acc = vertexColorAccumulator.get(key);
        if (!acc) {
          acc = [0, 0, 0, 0];
          vertexColorAccumulator.set(key, acc);
        }
        acc[0] += cr;
        acc[1] += cg;
        acc[2] += cb;
        acc[3] += 1;
      }
    }
  }

  const positions = [];
  const colors = [];
  const ghostPositions = [];
  const ghostColors = [];
  const wirePositions = [];
  const normalPositions = [];

  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    if (outerOnly && !p.is_outer) continue;
    if (p.floor_number < minFloor || p.floor_number > maxFloor) continue;
    if (disabledGroups.has(p.group_name)) continue;

    const verts = p.vertices;
    if (!verts || verts.length < 3) continue;

    const matchesExposure = isPanelMatchingExposure(p);
    if (!matchesExposure && isolateExposureOnly) continue;

    const [cr, cg, cb] = getPanelColorRGB(p, colorMode, totalFloors, heatmapSubmode);
    const isIncluded = isPanelActive(p);
    const dimFactor = isIncluded ? 1.0 : 0.45;

    const getCornerRGB = (v) => {
      if (useSmoothVertexColors) {
        const acc = vertexColorAccumulator.get(vKey(v));
        if (acc && acc[3] > 0) {
          return [(acc[0] / acc[3]) * dimFactor, (acc[1] / acc[3]) * dimFactor, (acc[2] / acc[3]) * dimFactor];
        }
      }
      return [cr * dimFactor, cg * dimFactor, cb * dimFactor];
    };

    const v0 = verts[0];
    const [r0, g0, b0] = getCornerRGB(v0);

    for (let k = 1; k < verts.length - 1; k++) {
      const v1 = verts[k];
      const v2 = verts[k + 1];
      const [r1, g1, b1] = getCornerRGB(v1);
      const [r2, g2, b2] = getCornerRGB(v2);

      if (matchesExposure) {
        positions.push(v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]);
        colors.push(r0, g0, b0, r1, g1, b1, r2, g2, b2);
        triToPanelIndex.push(i);
      } else {
        // Non-selected exposure direction in Ghosted (15% opacity) mode
        ghostPositions.push(v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]);
        ghostColors.push(r0 * 0.75, g0 * 0.75, b0 * 0.75, r1 * 0.75, g1 * 0.75, b1 * 0.75, r2 * 0.75, g2 * 0.75, b2 * 0.75);
      }
    }

    if (showWireframe && matchesExposure) {
      for (let k = 0; k < verts.length; k++) {
        const va = verts[k];
        const vb = verts[(k + 1) % verts.length];
        wirePositions.push(va[0], va[1], va[2], vb[0], vb[1], vb[2]);
      }
    }

    if (showNormals && matchesExposure && p.centroid && p.normal) {
      const c = p.centroid;
      const n = p.normal;
      normalPositions.push(c[0], c[1], c[2], c[0] + n[0] * 1.3, c[1] + n[1] * 1.3, c[2] + n[2] * 1.3);
    }
  }

  // 1A. Build Primary Active/Highlighted Panel Mesh
  if (positions.length > 0) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    mergedPanelMesh = new THREE.Mesh(geom, mat);
    envelopeRootGroup.add(mergedPanelMesh);
  } else {
    mergedPanelMesh = null;
  }

  // 1B. Build Ghosted (15% Opacity) Mesh for Non-Selected Orientations
  if (ghostPositions.length > 0) {
    const gGeom = new THREE.BufferGeometry();
    gGeom.setAttribute('position', new THREE.Float32BufferAttribute(ghostPositions, 3));
    gGeom.setAttribute('color', new THREE.Float32BufferAttribute(ghostColors, 3));
    gGeom.computeVertexNormals();

    const gMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    });
    ghostPanelMesh = new THREE.Mesh(gGeom, gMat);
    envelopeRootGroup.add(ghostPanelMesh);
  } else {
    ghostPanelMesh = null;
  }

  // 2. Build Merged Wireframe
  if (showWireframe && wirePositions.length > 0) {
    const wGeom = new THREE.BufferGeometry();
    wGeom.setAttribute('position', new THREE.Float32BufferAttribute(wirePositions, 3));
    const isDark = document.documentElement.classList.contains('dark');
    const wMat = new THREE.LineBasicMaterial({
      color: isDark ? 0x334155 : 0x5c645a,
      transparent: true,
      opacity: isDark ? 0.38 : 0.42,
    });
    mergedWireframe = new THREE.LineSegments(wGeom, wMat);
    envelopeRootGroup.add(mergedWireframe);
  }

  // 3. Build Merged Frame & Shading Mesh
  if (showFrames) {
    const framePos = [];
    const frameCol = [];

    const frameGroups = (currentAnalysisData.frame_elements || []).map((g) => ({ ...g, isShade: false }));
    const shadeGroups = (currentAnalysisData.shading_elements || []).map((g) => ({ ...g, isShade: true }));

    for (const grp of [...frameGroups, ...shadeGroups]) {
      if (disabledGroups.has(grp.group_name)) continue;
      const vs = grp.vertices || [];
      const fs = grp.faces || [];
      const fc = grp.isShade ? [0.35, 0.46, 0.37] : [0.42, 0.45, 0.43];

      for (let i = 0; i < fs.length; i++) {
        const f = fs[i];
        const v0 = vs[f[0]];
        const v1 = vs[f[1]];
        const v2 = vs[f[2]];
        if (!v0 || !v1 || !v2) continue;
        const avgZ = (v0[2] + v1[2] + v2[2]) / 3.0;
        if (avgZ < zMinClip || avgZ > zMaxClip) continue;

        framePos.push(v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]);
        frameCol.push(fc[0], fc[1], fc[2], fc[0], fc[1], fc[2], fc[0], fc[1], fc[2]);
      }
    }

    if (framePos.length > 0) {
      const fGeom = new THREE.BufferGeometry();
      fGeom.setAttribute('position', new THREE.Float32BufferAttribute(framePos, 3));
      fGeom.setAttribute('color', new THREE.Float32BufferAttribute(frameCol, 3));
      fGeom.computeVertexNormals();

      const fMat = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: activeExposureDirection !== 'ALL',
        opacity: activeExposureDirection !== 'ALL' ? 0.35 : 1.0,
      });
      mergedFrameMesh = new THREE.Mesh(fGeom, fMat);
      envelopeRootGroup.add(mergedFrameMesh);
    }
  }

  // 4. Build Normal Vectors
  if (showNormals && normalPositions.length > 0) {
    const nGeom = new THREE.BufferGeometry();
    nGeom.setAttribute('position', new THREE.Float32BufferAttribute(normalPositions, 3));
    const nMat = new THREE.LineBasicMaterial({ color: 0x0284c7 });
    normalsLineSegments = new THREE.LineSegments(nGeom, nMat);
    envelopeRootGroup.add(normalsLineSegments);
  }

  // 5. Build 3D Ground Compass Rose & Proportional 3D Sun-Path Dome
  sunDomeGroup = buildCompassAndSunDome(showRays);
  envelopeRootGroup.add(sunDomeGroup);

  // 6. Build 3D Floor Section Cut Planes
  sectionCutGroup = buildFloorSectionCutPlanes(minFloor, maxFloor, totalFloors, floorHeight);
  envelopeRootGroup.add(sectionCutGroup);

  if (resetCamera && (mergedPanelMesh || ghostPanelMesh || mergedFrameMesh)) {
    fitCameraToModel();
  }

  updateSelectedPanelHighlight();
}

function fitCameraToModel() {
  const bbox = currentAnalysisData?.summary?.bounding_box;
  if (bbox) {
    const [cx, cy, cz] = bbox.center;
    const maxDim = Math.max(bbox.max_span || 86, 30);
    controls.target.set(cx, cy, cz);
    camera.position.set(cx + maxDim * 0.92, cy - maxDim * 1.12, cz + maxDim * 0.42);
    if (cameraMode === 'axonometric') {
      const container = document.getElementById('three-viewport');
      const aspect = container ? (container.clientWidth || 800) / (container.clientHeight || 540) : 1.48;
      orthoFrustumHalfH = maxDim * 0.72;
      orthoCamera.left = -orthoFrustumHalfH * aspect;
      orthoCamera.right = orthoFrustumHalfH * aspect;
      orthoCamera.top = orthoFrustumHalfH;
      orthoCamera.bottom = -orthoFrustumHalfH;
      orthoCamera.zoom = 1.0;
      orthoCamera.updateProjectionMatrix();
    }
    controls.update();
    return;
  }

  const targetMesh = mergedPanelMesh || ghostPanelMesh || mergedFrameMesh;
  if (!targetMesh) return;
  targetMesh.geometry.computeBoundingBox();
  const box = targetMesh.geometry.boundingBox;
  if (!box) return;
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z, 20);
  controls.target.copy(center);
  camera.position.set(center.x + maxDim * 0.85, center.y - maxDim * 1.05, center.z + maxDim * 0.38);
  controls.update();
}

function rotateCameraToAzimuth(azimuthDeg, elevationRatio = 0.28) {
  const bbox = currentAnalysisData?.summary?.bounding_box || {
    center: [0, 0, 42],
    max_span: 86.4,
  };
  const [cx, cy, cz] = bbox.center;
  const dist = Math.max(bbox.max_span || 86, 36) * 1.25;
  const worldRad = THREE.MathUtils.degToRad(azimuthDeg + currentNorthAngle);

  controls.target.set(cx, cy, cz);
  camera.position.set(
    cx + Math.sin(worldRad) * dist,
    cy + Math.cos(worldRad) * dist,
    cz + dist * elevationRatio
  );
  controls.update();
}

// ============================================================================
// 9. PANEL SELECTION & 3D HIGHLIGHT OVERLAY
// ============================================================================
function updateSelectedPanelHighlight() {
  if (!selectedHighlightGroup) return;
  while (selectedHighlightGroup.children.length > 0) {
    const c = selectedHighlightGroup.children[0];
    c.geometry?.dispose();
    c.material?.dispose();
    selectedHighlightGroup.remove(c);
  }

  const targetId = lockedPanelId || hoveredPanelId;
  if (!targetId || !currentAnalysisData) return;

  const panel = currentAnalysisData.panels.find((p) => p.id === targetId);
  if (!panel || !panel.vertices || panel.vertices.length < 3) return;

  const verts = panel.vertices;
  const pos = [];
  const v0 = verts[0];
  for (let k = 1; k < verts.length - 1; k++) {
    const v1 = verts[k];
    const v2 = verts[k + 1];
    pos.push(v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]);
  }

  const hGeom = new THREE.BufferGeometry();
  hGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const isLocked = Boolean(lockedPanelId && lockedPanelId === panel.id);
  const hMat = new THREE.MeshBasicMaterial({
    color: isLocked ? 0xfacc15 : 0x34d399,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: isLocked ? 0.88 : 0.65,
    depthTest: false,
  });
  const hMesh = new THREE.Mesh(hGeom, hMat);
  selectedHighlightGroup.add(hMesh);

  const loopPts = verts.map((v) => new THREE.Vector3(v[0], v[1], v[2]));
  loopPts.push(loopPts[0].clone());
  const lGeom = new THREE.BufferGeometry().setFromPoints(loopPts);
  const lMat = new THREE.LineBasicMaterial({
    color: isLocked ? 0xd97706 : 0x059669,
    depthTest: false,
  });
  selectedHighlightGroup.add(new THREE.Line(lGeom, lMat));
}

function onViewportPointerMove(event) {
  if (!mergedPanelMesh || !currentAnalysisData) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(mergedPanelMesh, false);
  if (hits.length > 0) {
    const faceIdx = hits[0].faceIndex;
    const panelIdx = triToPanelIndex[faceIdx];
    const panel = currentAnalysisData.panels[panelIdx];
    if (panel) {
      hoveredPanelId = panel.id;
      if (!lockedPanelId) {
        populateInspectorCard(panel, false);
        updateSelectedPanelHighlight();
      }
      return;
    }
  }
  hoveredPanelId = null;
  if (!lockedPanelId) {
    updateSelectedPanelHighlight();
  }
}

function onViewportClick(event) {
  if (!mergedPanelMesh || !currentAnalysisData) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(mergedPanelMesh, false);
  if (hits.length > 0) {
    const faceIdx = hits[0].faceIndex;
    const panelIdx = triToPanelIndex[faceIdx];
    const panel = currentAnalysisData.panels[panelIdx];
    if (panel) {
      selectAndLockPanel(panel.id, false);
      return;
    }
  }
  lockedPanelId = null;
  document.getElementById('insp-lock-state').textContent = 'Mode: Hover';
  updateSelectedPanelHighlight();
  renderPanelsTablePage();
}

function selectAndLockPanel(panelId, scrollCamera = false) {
  if (!currentAnalysisData) return;
  const panel = currentAnalysisData.panels.find((p) => p.id === panelId);
  if (!panel) return;

  lockedPanelId = panel.id;
  populateInspectorCard(panel, true);
  updateSelectedPanelHighlight();
  renderPanelsTablePage();

  if (scrollCamera && panel.centroid && panel.normal) {
    const [cx, cy, cz] = panel.centroid;
    const [nx, ny, nz] = panel.normal;
    controls.target.set(cx, cy, cz);
    camera.position.set(cx + nx * 28 + 12, cy + ny * 28 - 12, cz + nz * 10 + 8);
    controls.update();
  }
}

function populateInspectorCard(panel, isLocked) {
  document.getElementById('insp-panel-id').textContent = panel.id;
  document.getElementById('insp-panel-group').textContent = panel.group_name;
  document.getElementById('insp-panel-floor').textContent = panel.floor_label || `L${panel.floor_number}`;
  document.getElementById('insp-lock-state').textContent = isLocked
    ? 'Terkunci (Klik 3D kosong untuk lepas)'
    : 'Mode: Hover';

  document.getElementById('insp-panel-type').textContent =
    panel.element_type === 'glazing' ? 'GLAZING (Kaca)' : 'WALL (Spandrel)';
  document.getElementById('insp-area').textContent = `${panel.area_m2.toFixed(2)} m²`;
  document.getElementById('insp-azimuth').textContent = `${panel.azimuth_deg.toFixed(1)}° (${panel.orientation_code})`;
  const sunHours = panel.direct_sun_hours ?? 4;
  document.getElementById('insp-tilt').textContent = `${sunHours} jam/hari · ${panel.tilt_deg.toFixed(1)}°`;
  document.getElementById('insp-normal').textContent = `(${panel.normal.map((n) => n.toFixed(2)).join(', ')})`;
  document.getElementById('insp-sf').textContent = `${panel.sf_wm2.toFixed(1)} W/m²`;
  document.getElementById('insp-sc').textContent = panel.sc_effective.toFixed(3);
  const compVal = panel.ottv_composite_wm2 ?? panel.ottv_panel_wm2;
  document.getElementById('insp-ottv').textContent = `${compVal.toFixed(2)} / ${panel.ottv_panel_wm2.toFixed(1)} W/m²`;

  const footerRight = document.getElementById('live-model-footer-right');
  if (footerRight) {
    footerRight.textContent = `${panel.id} (${panel.orientation_code}) · ${panel.area_m2.toFixed(2).replace('.', ',')} m² · Komposit ${compVal.toFixed(2)} W/m²`;
  }
}

// ============================================================================
// 10. ACTIVE PANEL CHECK & INSTANT LIVE OTTV RECALCULATION
// ============================================================================
function isPanelActive(panel) {
  if (manualPanelActiveMap.has(panel.id)) {
    return manualPanelActiveMap.get(panel.id);
  }
  return Boolean(panel.active);
}

function recalculateLiveKPIsFromActivePanels() {
  if (!currentAnalysisData) return;
  const panels = currentAnalysisData.panels || [];
  const minFloor = parseInt(document.getElementById('slider-floor-min')?.value || '1', 10);
  const maxFloor = parseInt(document.getElementById('slider-floor-max')?.value || '999', 10);
  const floorHeight = parseFloat(document.getElementById('input-floor-height')?.value || '3.6');
  const zMinBase = currentAnalysisData.summary?.z_min_m || 0;

  let totalArea = 0;
  let windowArea = 0;
  let totalHeatW = 0;
  let activeCount = 0;
  let tiltedActiveCount = 0;

  for (const p of panels) {
    if (p.floor_number < minFloor || p.floor_number > maxFloor) continue;
    if (!isPanelActive(p)) continue;
    activeCount++;
    if ((p.verification_label || '').includes('Condong') || (p.verification_label || '').includes('Perlu')) {
      tiltedActiveCount++;
    }
    totalArea += p.area_m2;
    if (p.element_type === 'glazing') windowArea += p.area_m2;
    totalHeatW += p.heat_gain_w;
  }

  const liveOttv = totalArea > 0 ? totalHeatW / totalArea : 0;
  const liveWwr = totalArea > 0 ? windowArea / totalArea : 0;
  const isCompliant = liveOttv <= 35.0;

  const ottvEl = document.getElementById('header-ottv-value');
  const badgeEl = document.getElementById('header-compliance-badge');
  if (ottvEl) {
    ottvEl.textContent = liveOttv.toFixed(2);
    ottvEl.className = `text-xl font-mono font-bold ${
      isCompliant ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
    }`;
  }
  if (badgeEl) {
    badgeEl.textContent = isCompliant ? 'MEMENUHI SNI 6389:2020' : 'MELEBIHI BATAS (>35 W/m²)';
    badgeEl.className = isCompliant
      ? 'px-3 py-1.5 rounded-lg border text-xs font-mono font-bold bg-emerald-100 border-emerald-300 text-emerald-900 dark:bg-emerald-950/80 dark:border-emerald-700 dark:text-emerald-300'
      : 'px-3 py-1.5 rounded-lg border text-xs font-mono font-bold bg-rose-100 border-rose-300 text-rose-900 dark:bg-rose-950/80 dark:border-rose-700 dark:text-rose-300';
  }

  const bidangCountEl = document.getElementById('live-model-bidang-count');
  if (bidangCountEl) {
    bidangCountEl.textContent = `${panels.length} bidang (${activeCount} aktif)`;
  }

  const footerLeft = document.getElementById('live-model-footer-left');
  if (footerLeft) {
    footerLeft.textContent = `${activeCount} bidang aktif condong (${tiltedActiveCount}) · WWR ${(liveWwr * 100).toFixed(1)}% · Luas ${totalArea.toLocaleString('id-ID', { maximumFractionDigits: 1 })} m²`;
  }

  // Update Smart Floor Sectioning KPI strip
  const { zLow, zHigh } = getFloorZBounds(minFloor, maxFloor, floorHeight);
  const zLo = zLow.toFixed(1);
  const zHi = zHigh.toFixed(1);
  const kpiZ = document.getElementById('floor-kpi-zrange');
  const kpiArea = document.getElementById('floor-kpi-area');
  const kpiWwr = document.getElementById('floor-kpi-wwr');
  const kpiOttv = document.getElementById('floor-kpi-ottv');
  if (kpiZ) kpiZ.textContent = `${zLo} – ${zHi} m`;
  if (kpiArea) kpiArea.textContent = `${totalArea.toLocaleString('id-ID', { maximumFractionDigits: 1 })} m²`;
  if (kpiWwr) kpiWwr.textContent = `${(liveWwr * 100).toFixed(1)}%`;
  if (kpiOttv) {
    kpiOttv.textContent = `${liveOttv.toFixed(2)} W/m²`;
    kpiOttv.className = `font-bold mt-0.5 ${
      isCompliant ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
    }`;
  }
}

// ============================================================================
// 11. CHARTS & 8-ORIENTATION BREAKDOWN (CLICK ROW TO HIGHLIGHT 3D)
// ============================================================================
function updateChartsAndOrientationTable(data) {
  const rows = data.orientation_breakdown || [];
  const labels = rows.map((r) => r.code);
  const ottvVals = rows.map((r) => r.ottv_orientation_wm2);
  const limitVals = rows.map(() => 35.0);

  const isDark = document.documentElement.classList.contains('dark');
  const textColor = isDark ? '#94a3b8' : '#4b5563';
  const gridColor = isDark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(100, 116, 139, 0.18)';

  const radarCtx = document.getElementById('chart-orientation-radar').getContext('2d');
  if (radarChart) radarChart.destroy();
  radarChart = new Chart(radarCtx, {
    type: 'radar',
    data: {
      labels,
      datasets: [
        {
          label: 'OTTV Orientasi (W/m²)',
          data: ottvVals,
          backgroundColor: 'rgba(16, 185, 129, 0.22)',
          borderColor: '#059669',
          pointBackgroundColor: '#059669',
          borderWidth: 2,
        },
        {
          label: 'Batas SNI (35 W/m²)',
          data: limitVals,
          backgroundColor: 'rgba(244, 63, 94, 0.04)',
          borderColor: 'rgba(225, 29, 72, 0.65)',
          borderDash: [4, 4],
          pointRadius: 0,
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          beginAtZero: true,
          suggestedMax: 45,
          angleLines: { color: gridColor },
          grid: { color: gridColor },
          pointLabels: { color: textColor, font: { family: 'JetBrains Mono', size: 10 } },
          ticks: { display: false },
        },
      },
      plugins: {
        legend: { labels: { color: textColor, font: { size: 10 }, boxWidth: 10 } },
      },
    },
  });

  const barCtx = document.getElementById('chart-orientation-bar').getContext('2d');
  if (barChart) barChart.destroy();
  barChart = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Konduksi Dinding',
          data: rows.map((r) => r.q_wall_conduction_wm2),
          backgroundColor: '#d97706',
        },
        {
          label: 'Konduksi Kaca',
          data: rows.map((r) => r.q_glass_conduction_wm2),
          backgroundColor: '#0284c7',
        },
        {
          label: 'Radiasi Surya',
          data: rows.map((r) => r.q_solar_radiation_wm2),
          backgroundColor: '#059669',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 10 } },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 10 } },
        },
      },
      plugins: {
        legend: { labels: { color: textColor, font: { size: 9 }, boxWidth: 8 } },
      },
    },
  });

  const tbody = document.getElementById('table-orientation-body');
  if (tbody) {
    tbody.innerHTML = rows
      .map((r) => {
        const over = r.ottv_orientation_wm2 > 35.0;
        const isSel = activeExposureDirection === r.code;
        return `
        <tr data-ori-row="${r.code}" class="cursor-pointer transition hover:opacity-80 ${
          isSel ? 'bg-emerald-100/70 dark:bg-emerald-900/40 font-bold' : ''
        }">
          <td class="py-1 pr-1 font-bold">${r.code} <span class="opacity-60 font-normal">(${r.name_id})</span></td>
          <td class="py-1 px-1 text-right">${r.total_area_m2.toFixed(1)}</td>
          <td class="py-1 px-1 text-right">${r.sni_sf_wm2}</td>
          <td class="py-1 px-1 text-right">${r.glazing_area_m2 > 0 ? Number(r.avg_sc_effective || 0).toFixed(3) : '—'}</td>
          <td class="py-1 pl-1 text-right font-bold ${
            over ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'
          }">${r.ottv_orientation_wm2.toFixed(2)}</td>
        </tr>
      `;
      })
      .join('');

    tbody.querySelectorAll('[data-ori-row]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const code = tr.getAttribute('data-ori-row');
        setActiveExposureDirection(activeExposureDirection === code ? 'ALL' : code);
      });
    });
  }
}

function setActiveExposureDirection(dirCode) {
  activeExposureDirection = dirCode;

  // Update pill button styles
  document.querySelectorAll('[data-dir-pill]').forEach((btn) => {
    const code = btn.getAttribute('data-dir-pill');
    if (code === dirCode) {
      btn.className = 'px-2.5 py-1 rounded-lg bg-emerald-800 text-white font-bold transition shadow-sm';
    } else if (code === 'SUNLIT_HOUR') {
      btn.className =
        'studio-input px-2.5 py-1 rounded-lg text-amber-800 dark:text-amber-300 border-amber-400/70 hover:opacity-80 transition';
    } else {
      btn.className = 'studio-input px-2 py-1 rounded-lg hover:opacity-80 transition';
    }
  });

  // Auto-rotate camera to face selected compass direction if enabled
  const autoFocus = document.getElementById('chk-exposure-autofocus')?.checked ?? true;
  if (autoFocus && ORIENTATION_META[dirCode]) {
    rotateCameraToAzimuth(ORIENTATION_META[dirCode].angle, 0.22);
  }

  if (currentAnalysisData) {
    updateChartsAndOrientationTable(currentAnalysisData);
  }
  rebuild3DScene(false);
  applyPanelTableFilters();
}

// ============================================================================
// 12. 5-STAGE GATEKEEPER STEPPER, DYNAMIC MODEL CATALOG & STAGE 2/3/4 UI
// ============================================================================
function populateDynamicModelSelect(availableModels, activeId) {
  if (Array.isArray(availableModels) && availableModels.length > 0) {
    // Deduplicate by id
    const seen = new Set();
    availableModelsCatalog = availableModels.filter((m) => {
      if (!m || !m.id || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }
  const sel = document.getElementById('preset-select');
  if (!sel || availableModelsCatalog.length === 0) return;

  const uploaded = availableModelsCatalog.filter((m) => m.is_uploaded || m.category === 'uploaded');
  const refs = availableModelsCatalog.filter((m) => !(m.is_uploaded || m.category === 'uploaded'));

  let html = '';
  if (uploaded.length > 0) {
    html += `<optgroup label="📂 Model Unggahan Proyek">`;
    for (const m of uploaded) {
      const selAttr = m.id === activeId ? 'selected' : '';
      const label = m.title || m.name || m.filename || m.id;
      html += `<option value="${m.id}" ${selAttr}>${label}</option>`;
    }
    html += `</optgroup>`;
  }

  if (refs.length > 0) {
    html += `<optgroup label="🏛️ Sampel Referensi Multi-Format">`;
    for (const m of refs) {
      const selAttr = m.id === activeId ? 'selected' : '';
      const label = m.title || m.name || m.filename || m.id;
      html += `<option value="${m.id}" ${selAttr}>${label}</option>`;
    }
    html += `</optgroup>`;
  }

  sel.innerHTML = html;
  const resolvedActive = activeId || sel.value || availableModelsCatalog[0]?.id || '';
  if (resolvedActive) {
    sel.value = resolvedActive;
  }

  // Update custom dropdown button label & render format-grouped menu rows with inline delete
  const activeEntry = activeId ? availableModelsCatalog.find((m) => m.id === activeId) : null;
  const lblEl = document.getElementById('model-dropdown-label');
  if (lblEl) {
    if (activeEntry) {
      lblEl.textContent = activeEntry.title || activeEntry.filename || activeEntry.id;
      lblEl.title = lblEl.textContent;
    } else {
      lblEl.textContent = '— Tidak Ada Model Aktif (Pilih / Impor) —';
      lblEl.title = 'Pilih model dari katalog atau impor model baru';
    }
  }

  renderCustomModelDropdownMenu(uploaded, refs, activeId || '');
}

let activeCatalogFormatFilter = 'ALL';

const FORMAT_GROUP_META = {
  IFC:    { icon: '&#128208;', label: 'Format .IFC — BIM Native (Archicad / Revit / buildingSMART / IFC4X3)', badge: 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-200' },
  '3DM':  { icon: '&#129482;', label: 'Format .3DM — Rhinoceros 3D NURBS & Curtain Wall', badge: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200' },
  OBJ:    { icon: '&#129521;', label: 'Format .OBJ — Wavefront Multi-Material Mesh', badge: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200' },
  GLB:    { icon: '&#10024;',  label: 'Format .GLB — glTF 2.0 PBR SceneGraph', badge: 'bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-200' },
  HBJSON: { icon: '&#9728;',   label: 'Format .HBJSON — Ladybug / Honeybee Thermal Models', badge: 'bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-200' },
};

function _normFormatKey(fmt) {
  const f = String(fmt || '').toUpperCase().replace(/^ZIP→/, '');
  if (f === 'JSON') return 'HBJSON';
  if (f === 'GLTF') return 'GLB';
  return f || 'OTHER';
}

function renderCustomModelDropdownMenu(uploaded, refs, activeId) {
  const menu = document.getElementById('model-dropdown-menu');
  if (!menu) return;

  const esc = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  // Count samples per format for filter pills
  const allItems = [...uploaded, ...refs];
  const fmtCounts = {};
  for (const m of allItems) {
    const fk = _normFormatKey(m.format);
    fmtCounts[fk] = (fmtCounts[fk] || 0) + 1;
  }
  const orderedFormats = ['IFC', '3DM', 'OBJ', 'GLB', 'HBJSON'].filter((k) => fmtCounts[k] > 0);
  if (activeCatalogFormatFilter !== 'ALL' && !fmtCounts[activeCatalogFormatFilter]) {
    activeCatalogFormatFilter = 'ALL';
  }

  let out = `
    <div class="sticky top-0 z-10 studio-card pb-1.5 border-b space-y-1.5" style="border-color: var(--border-color);">
      <div class="flex flex-wrap items-center gap-1 text-[10px] font-mono">
        <button type="button" data-fmt-filter="ALL" class="px-2 py-0.5 rounded-md font-bold transition ${
          activeCatalogFormatFilter === 'ALL' ? 'bg-emerald-800 text-white' : 'studio-subtle hover:opacity-80'
        }">Semua (${allItems.length})</button>
        ${orderedFormats
          .map(
            (fk) => `
          <button type="button" data-fmt-filter="${fk}" class="px-2 py-0.5 rounded-md font-semibold transition ${
              activeCatalogFormatFilter === fk ? 'bg-emerald-800 text-white' : 'studio-subtle hover:opacity-80'
            }">.${fk} (${fmtCounts[fk]})</button>`
          )
          .join('')}
      </div>
    </div>`;

  const matchFmt = (m) => activeCatalogFormatFilter === 'ALL' || _normFormatKey(m.format) === activeCatalogFormatFilter;
  const visUploaded = uploaded.filter(matchFmt);
  const visRefs = refs.filter(matchFmt);

  // 1. User Uploaded Models (with inline delete button on EVERY row)
  if (visUploaded.length > 0) {
    out += `<div class="px-2 pt-1.5 pb-0.5 text-[10px] font-mono font-bold uppercase opacity-75 flex items-center justify-between">
      <span>&#128194; Model Unggahan Proyek (${visUploaded.length})</span>
      <span class="text-[9px] font-normal opacity-75">Klik &#128465; untuk hapus file</span>
    </div>`;
    for (const m of visUploaded) {
      const isAct = m.id === activeId;
      const fname = m.filename || m.id;
      const meta = `${m.format || ''}${m.size_mb != null ? ` · ${m.size_mb} MB` : ''}`;
      out += `
        <div class="flex items-center justify-between gap-1.5 rounded-lg px-2 py-1.5 transition ${
          isAct
            ? 'bg-emerald-100/85 dark:bg-emerald-950/65 font-semibold ring-1 ring-emerald-500/40'
            : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/70'
        }">
          <button type="button" data-select-model-id="${esc(m.id)}" class="flex-1 min-w-0 text-left flex items-center gap-1.5">
            <span class="w-3.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 shrink-0">${isAct ? '✓' : ''}</span>
            <div class="min-w-0">
              <div class="text-xs truncate" title="${esc(fname)}">${esc(fname)}</div>
              <div class="text-[10px] font-mono opacity-65">${esc(meta)}</div>
            </div>
          </button>
          <button type="button" data-delete-model-id="${esc(m.id)}" data-delete-model-name="${esc(fname)}" class="shrink-0 px-2 py-1 rounded-md text-[11px] font-bold border border-rose-300/80 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-700 transition" title="Hapus permanen file ${esc(fname)}">
            &#128465;
          </button>
        </div>`;
    }
  }

  // 2. Reference & Training Library Samples Grouped Strictly by Format (.IFC, .3DM, .OBJ, .GLB, .HBJSON)
  if (visRefs.length > 0) {
    const byFmt = {};
    for (const m of visRefs) {
      const fk = _normFormatKey(m.format);
      if (!byFmt[fk]) byFmt[fk] = [];
      byFmt[fk].push(m);
    }

    for (const fk of ['IFC', '3DM', 'OBJ', 'GLB', 'HBJSON', ...Object.keys(byFmt)]) {
      const list = byFmt[fk];
      if (!list || list.length === 0) continue;
      delete byFmt[fk];
      const fMeta = FORMAT_GROUP_META[fk] || {
        icon: '&#128196;',
        label: `Format .${fk}`,
        badge: 'studio-subtle',
      };
      out += `<div class="px-2 pt-2 pb-0.5 text-[10px] font-mono font-bold uppercase opacity-75 border-t mt-1 flex items-center justify-between gap-2" style="border-color: var(--border-color);">
        <span class="truncate">${fMeta.icon} ${fMeta.label}</span>
        <span class="px-1.5 py-0.5 rounded text-[9px] shrink-0 ${fMeta.badge}">${list.length}</span>
      </div>`;
      for (const m of list) {
        const isAct = m.id === activeId;
        const label = m.title || m.filename || m.id;
        const szTxt = m.size_mb != null ? `${m.size_mb} MB` : 'Sampel';
        out += `
          <div class="flex items-center justify-between gap-1.5 rounded-lg px-2 py-1.5 transition ${
            isAct
              ? 'bg-emerald-100/85 dark:bg-emerald-950/65 font-semibold ring-1 ring-emerald-500/40'
              : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/70'
          }">
            <button type="button" data-select-model-id="${esc(m.id)}" class="flex-1 min-w-0 text-left flex items-center gap-1.5">
              <span class="w-3.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 shrink-0">${isAct ? '✓' : ''}</span>
              <div class="min-w-0">
                <div class="text-xs truncate" title="${esc(label)}">${esc(label)}</div>
                <div class="text-[10px] font-mono opacity-60 truncate">${esc(m.filename || '')} &middot; ${esc(szTxt)}</div>
              </div>
            </button>
            <span class="shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded ${fMeta.badge}">.${fk}</span>
          </div>`;
      }
    }
  }

  menu.innerHTML = out;

  // Bind format filter pills inside dropdown (keeps dropdown open!)
  menu.querySelectorAll('[data-fmt-filter]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      activeCatalogFormatFilter = btn.getAttribute('data-fmt-filter') || 'ALL';
      renderCustomModelDropdownMenu(uploaded, refs, activeId);
    });
  });

  // Bind select click on each model row
  menu.querySelectorAll('[data-select-model-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextId = btn.getAttribute('data-select-model-id');
      closeModelDropdownMenu();
      const sel = document.getElementById('preset-select');
      if (sel && nextId) {
        sel.value = nextId;
        sel.dispatchEvent(new Event('change'));
      }
    });
  });

  // Bind inline delete click on THAT specific uploaded file row
  menu.querySelectorAll('[data-delete-model-id]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const delId = btn.getAttribute('data-delete-model-id');
      const delName = btn.getAttribute('data-delete-model-name') || delId;
      await deleteUploadedModelById(delId, delName);
    });
  });
}

function closeModelDropdownMenu() {
  const menu = document.getElementById('model-dropdown-menu');
  const trig = document.getElementById('btn-model-dropdown');
  menu?.classList.add('hidden');
  trig?.setAttribute('aria-expanded', 'false');
}

function clear3DViewportScene() {
  if (!envelopeRootGroup) return;
  while (envelopeRootGroup.children.length > 0) {
    const child = envelopeRootGroup.children.pop();
    child.traverse?.((obj) => {
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
      else obj.material?.dispose?.();
    });
  }
  mergedPanelMesh = null;
  ghostPanelMesh = null;
  mergedWireframe = null;
  mergedFrameMesh = null;
  normalsLineSegments = null;
  sunDomeGroup = null;
  sectionCutGroup = null;
  selectedHighlightGroup = null;
  triToPanelIndex = [];
}

function enterEmptyStudioState(titleText, descText) {
  currentAnalysisData = null;
  currentPresetId = null;
  manualPanelActiveMap.clear();
  lockedPanelId = null;
  hoveredPanelId = null;
  clear3DViewportScene();
  if (radarChart) {
    radarChart.destroy();
    radarChart = null;
  }
  if (barChart) {
    barChart.destroy();
    barChart = null;
  }

  document.getElementById('studio-active-workspace-body')?.classList.add('hidden');
  const emptyPanel = document.getElementById('studio-empty-state-panel');
  if (emptyPanel) emptyPanel.classList.remove('hidden');
  const tEl = document.getElementById('studio-empty-state-title');
  const dEl = document.getElementById('studio-empty-state-desc');
  if (tEl && titleText) tEl.textContent = titleText;
  if (dEl && descText) dEl.textContent = descText;

  // Lock Header KPIs, Reinspect, and Official Excel Export while no model is active!
  const ottvEl = document.getElementById('header-ottv-value');
  const badgeEl = document.getElementById('header-compliance-badge');
  if (ottvEl) {
    ottvEl.textContent = '--';
    ottvEl.className = 'text-xl font-mono font-bold opacity-50';
  }
  if (badgeEl) {
    badgeEl.textContent = 'TIDAK ADA MODEL AKTIF';
    badgeEl.className = 'px-3 py-1.5 rounded-lg border text-xs font-mono font-bold studio-subtle opacity-75';
  }
  ['btn-open-staging-reinspect', 'btn-export-excel', 'btn-table-excel'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) {
      b.disabled = true;
      b.classList.add('opacity-45', 'cursor-not-allowed');
    }
  });

  populateDynamicModelSelect(availableModelsCatalog, '');
}

function exitEmptyStudioState() {
  document.getElementById('studio-empty-state-panel')?.classList.add('hidden');
  document.getElementById('studio-active-workspace-body')?.classList.remove('hidden');
  ['btn-open-staging-reinspect', 'btn-export-excel', 'btn-table-excel'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) {
      b.disabled = false;
      b.classList.remove('opacity-45', 'cursor-not-allowed');
    }
  });
  window.dispatchEvent(new Event('resize'));
}

function resetModelSpecificControls(nextModelId) {
  const entry = availableModelsCatalog.find((m) => m.id === nextModelId);
  currentSourceSoftware = entry?.source_software || 'archicad';
  disabledGroups.clear();
  groupCategoryOverrides = {};
  groupMaterialMap = {};
  groupsToAutoSplit.clear();
  groupWwrMap = {};
  orientationMaterialOverrides = {};
  currentZGroundCutoff = 0.0;
  faceCategoryOverrides = {};
  faceZBandOverrides = [];
  lockedPanelId = null;
  activeExposureDirection = 'ALL';

  // Reset UI selectors so previous model's unit/axis/auto-split NEVER poisons the newly selected model!
  const uSel = document.getElementById('select-unit-mode');
  if (uSel) uSel.value = 'auto';
  const axSel = document.getElementById('select-up-axis');
  if (axSel) axSel.value = 'auto';
  const extSel = document.getElementById('select-exterior-mode');
  if (extSel) extSel.value = 'auto';
  const chkSplit = document.getElementById('chk-auto-split-cw');
  if (chkSplit) chkSplit.checked = false;
  const flDetSel = document.getElementById('select-floor-detection-mode');
  if (flDetSel) flDetSel.value = 'auto';
  const flModeSel = document.getElementById('select-floor-mode');
  if (flModeSel) flModeSel.value = 'all';
  document.getElementById('custom-floor-zones-panel')?.classList.add('hidden');
  document.getElementById('upload-status-alert')?.classList.add('hidden');
}

async function deleteUploadedModelById(modelId, displayName) {
  if (!modelId) return;
  if (!window.confirm(`Hapus permanen file model "${displayName}" beserta konfigurasi staging-nya?`)) {
    return;
  }
  const wasActive = modelId === currentPresetId;
  try {
    const res = await fetch(`/api/models/${encodeURIComponent(modelId)}`, { method: 'DELETE' });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        msg = (await res.json()).detail || msg;
      } catch (_) {}
      throw new Error(msg);
    }
    const json = await res.json();
    const nextModels = json.available_models || [];
    availableModelsCatalog = nextModels;
    if (wasActive) {
      // STRICT UX RULE: Deleting the active model immediately closes Live Preview & locks OTTV analysis!
      closeModelDropdownMenu();
      enterEmptyStudioState(
        `Model "${displayName}" Telah Dihapus`,
        'Live Preview 3D dan seluruh modul analisa OTTV ditutup otomatis karena file aktif sudah dihapus. Pilih sampel lain dari katalog atau impor model baru melalui Ruang Inspeksi.'
      );
    } else {
      // Deleted an inactive file: keep dropdown open and remove that row immediately
      populateDynamicModelSelect(nextModels, currentPresetId || '');
    }
  } catch (err) {
    alert(`Gagal menghapus model "${displayName}": ${err.message}`);
  }
}

function renderStageGatesAndAudit(data) {
  const rawGates = data.stage_gates || {};
  const audit = data.stage1_geometry_audit || {};
  const isCompliant = Boolean(data.compliant ?? data.summary?.compliant);

  const gateList = Array.isArray(rawGates)
    ? rawGates
    : [
        rawGates.gate1_geometry,
        rawGates.gate2_groups,
        rawGates.gate3_floors,
        rawGates.gate4_materials,
        rawGates.gate5_compliance,
      ].filter(Boolean);

  // Update 5-Stage Gatekeeper cards
  let passedCount = 0;
  for (let i = 1; i <= 5; i++) {
    const g = Array.isArray(rawGates) ? rawGates.find((x) => x.stage === i) : gateList[i - 1];
    const badgeEl = document.getElementById(`gate-badge-${i}`);
    const sumEl = document.getElementById(`gate-summary-${i}`);
    if (!g) continue;

    const isPass = String(g.status || '').toUpperCase() === 'PASSED';
    if (isPass) passedCount++;

    if (badgeEl) {
      badgeEl.textContent = i === 5 ? (isPass ? 'MEMENUHI' : 'PERLU OPTIMASI') : isPass ? 'LOLOS' : 'TINJAU';
      badgeEl.className = isPass
        ? 'px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-100 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-200'
        : 'px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200';
    }
    if (sumEl) {
      sumEl.textContent = g.summary || '';
      sumEl.title = g.summary || '';
    }
  }

  const overallEl = document.getElementById('pipeline-overall-status');
  if (overallEl && gateList.length > 0) {
    overallEl.textContent = `${passedCount}/${gateList.length} Tahap Valid · ${
      isCompliant ? 'Memenuhi SNI 6389:2020 (≤ 35 W/m²)' : 'OTTV > 35 W/m² (Gunakan Rekomendasi Tahap 4)'
    }`;
  }

  // Update Stage 1 Geometry Audit Summary box
  const auditBox = document.getElementById('stage1-audit-summary');
  const spanArr = audit.normalized_span_m || audit.normalized_bbox_span_m;
  if (auditBox && Array.isArray(spanArr) && spanArr.length >= 3) {
    const [sx, sy, sz] = spanArr;
    const scaleStr = Number(audit.scale_factor_to_m || 1.0);
    const unitStr = audit.applied_unit || audit.detected_unit || 'm';
    const axisStr = audit.applied_up_axis || audit.detected_up_axis || 'Z';
    const storeysCount = audit.bim_storeys_count || 0;
    const kernelStr = audit.geometry_kernel || data.format || '3D';
    const sliv = audit.slivers_removed || 0;
    const extM = (audit.exterior_detection_mode || 'auto').toUpperCase();
    auditBox.innerHTML = `
      <div>Kernel: <strong>${kernelStr}</strong></div>
      <div>Dimensi Meter: <strong>${sx} &times; ${sy} &times; ${sz} m</strong></div>
      <div>Unit: <strong>${unitStr} (&times;${scaleStr})</strong> &bull; Sumbu: <strong>${axisStr}-Up</strong> &bull; Luar: <strong>${extM}</strong>${
      storeysCount > 0 ? ` &bull; Storey: <strong>${storeysCount}</strong>` : ''
    }${sliv > 0 ? ` &bull; Sliver Bersih: <strong>${sliv}</strong>` : ''}</div>
    `;
  }

  // Show diagnostic notes if unit conversion or Y-Up swap occurred
  const alertEl = document.getElementById('upload-status-alert');
  if (alertEl) {
    const notes = audit.notes || [];
    if (notes.length > 0) {
      alertEl.classList.remove('hidden');
      alertEl.innerHTML = `<strong>Audit Tahap 1 (${data.format || '3D'}):</strong> ${notes.join(' · ')}`;
    } else {
      alertEl.classList.add('hidden');
    }
  }
}

function renderGroupsTable(data) {
  const groups = data.groups || [];
  const tbody = document.getElementById('table-groups-body');
  const groupSelect = document.getElementById('table-filter-group');

  if (groupSelect) {
    const prev = groupSelect.value;
    groupSelect.innerHTML =
      `<option value="all">Semua kelompok</option>` +
      groups
        .filter((g) => ['glazing', 'spandrel', 'wall', 'composite_cw'].includes(g.category))
        .map((g) => `<option value="${g.group_name}">${g.group_id} · ${g.group_name} (${g.outer_faces} luar)</option>`)
        .join('');
    if ([...groupSelect.options].some((o) => o.value === prev)) {
      groupSelect.value = prev;
    }
  }

  if (!tbody) return;

  tbody.innerHTML = groups
    .map((g) => {
      const isEnabled = !disabledGroups.has(g.group_name);
      const cat = groupCategoryOverrides[g.group_name] || g.category;
      const assignedMat = groupMaterialMap[g.group_name] || g.material_id || '';
      const isSplitActive = groupsToAutoSplit.has(g.group_name);
      const isAlreadyAutoSplitChild = g.group_name.includes(':: [Auto]');
      const customWwrPct = Math.round((groupWwrMap[g.group_name] ?? g.composite_wwr ?? 0.6) * 100);

      const catMats = materialsCatalog.filter((m) =>
        cat === 'glazing' || cat === 'composite_cw'
          ? m.category === 'glazing'
          : cat === 'wall' || cat === 'spandrel'
          ? m.category === 'wall'
          : m.category === 'frame'
      );

      const matOptions =
        `<option value="">Default Kategori</option>` +
        catMats
          .map((m) => `<option value="${m.id}" ${assignedMat === m.id ? 'selected' : ''}>${m.brand} — ${m.name}</option>`)
          .join('');

      const roleDescMap = {
        glazing: 'Bidang Kaca Vision (Transparan · Dihitung OTTV)',
        spandrel: 'Bidang Spandrel Panel (Opaque CW · Konduksi Dinding)',
        wall: 'Dinding Masif Eksterior (Konduksi Dinding)',
        composite_cw: `Tier 3: Curtain Wall Komposit (WWR ${customWwrPct}%)`,
        frame: 'Rangka Mullion / Transom (Peneduh + U_frame)',
        shading: 'Sirip Peneduh / Louver / SkyGarden (Raycasting SC_eff)',
        ignore: 'Diabaikan (Interior / Partisi Dalam)',
      };
      const roleDesc = roleDescMap[cat] || 'Elemen Selubung';

      const splitBtnHtml = !isAlreadyAutoSplitChild
        ? `<button type="button" data-group-split="${g.group_name}" class="mt-1 px-2 py-0.5 rounded text-[10px] font-semibold transition ${
            isSplitActive
              ? 'bg-emerald-800 text-white'
              : 'studio-input hover:opacity-80 text-emerald-800 dark:text-emerald-300'
          }" title="Tier 2: Pecah kelompok tunggal ini menjadi Kaca Vision, Spandrel, dan Rangka Mullion secara otomatis">
            ${isSplitActive ? '✓ Auto-Split Aktif' : '⚡ Pecah Sub-Elemen BIM'}
          </button>`
        : `<span class="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200 font-semibold">Hasil Auto-Split Tier 2</span>`;

      const wwrInputHtml =
        cat === 'composite_cw'
          ? `<div class="mt-1 flex items-center gap-1 text-[10px]">
               <span>WWR:</span>
               <input type="number" data-group-wwr="${g.group_name}" min="5" max="95" step="5" value="${customWwrPct}" class="studio-input w-14 rounded px-1.5 py-0.5 text-[10px] font-mono" />
               <span>%</span>
             </div>`
          : '';

      return `
      <tr class="hover:opacity-90">
        <td class="py-2 pr-2 align-top">
          <input type="checkbox" data-group-toggle="${g.group_name}" ${
        isEnabled ? 'checked' : ''
      } class="w-4 h-4 accent-emerald-700 rounded cursor-pointer mt-1" />
        </td>
        <td class="py-2 px-2 align-top">
          <div class="font-bold">${g.group_id} &middot; ${g.group_name}</div>
          <div class="text-[10px] opacity-65">${roleDesc}</div>
        </td>
        <td class="py-2 px-2 align-top">
          <select data-group-cat="${g.group_name}" class="studio-input rounded px-2 py-1 text-[11px] w-full max-w-[215px]">
            <option value="glazing" ${cat === 'glazing' ? 'selected' : ''}>1. Bidang Kaca Vision (Glazing)</option>
            <option value="spandrel" ${cat === 'spandrel' ? 'selected' : ''}>2. Bidang Spandrel CW (Opaque)</option>
            <option value="wall" ${cat === 'wall' ? 'selected' : ''}>3. Dinding Masif (Beton/Bata/ACP)</option>
            <option value="composite_cw" ${cat === 'composite_cw' ? 'selected' : ''}>4. CW Komposit (Rasio WWR %)</option>
            <option value="frame" ${cat === 'frame' ? 'selected' : ''}>5. Rangka Mullion/Transom (Frame)</option>
            <option value="shading" ${cat === 'shading' ? 'selected' : ''}>6. Sirip Peneduh / Louver (Shading)</option>
            <option value="ignore" ${cat === 'ignore' ? 'selected' : ''}>7. Abaikan (Interior / Struktur)</option>
          </select>
          <div class="flex flex-wrap items-center gap-1.5">
            ${splitBtnHtml}
            ${wwrInputHtml}
          </div>
        </td>
        <td class="py-2 px-2 text-right align-top">${g.total_faces.toLocaleString('id-ID')}</td>
        <td class="py-2 px-2 text-right font-semibold align-top">${
          g.outer_area_m2 > 0 ? g.outer_area_m2.toFixed(1) : '—'
        }</td>
        <td class="py-2 pl-2 align-top">
          <select data-group-mat="${g.group_name}" class="studio-input rounded px-2 py-1 text-[11px] max-w-[210px] truncate">
            ${matOptions}
          </select>
        </td>
      </tr>
    `;
    })
    .join('');

  tbody.querySelectorAll('[data-group-toggle]').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const gName = e.target.getAttribute('data-group-toggle');
      if (e.target.checked) disabledGroups.delete(gName);
      else disabledGroups.add(gName);
      scheduleAnalyze();
    });
  });

  tbody.querySelectorAll('[data-group-cat]').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const gName = e.target.getAttribute('data-group-cat');
      groupCategoryOverrides[gName] = e.target.value;
      scheduleAnalyze();
    });
  });

  tbody.querySelectorAll('[data-group-split]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gName = btn.getAttribute('data-group-split');
      if (groupsToAutoSplit.has(gName)) groupsToAutoSplit.delete(gName);
      else groupsToAutoSplit.add(gName);
      scheduleAnalyze();
    });
  });

  tbody.querySelectorAll('[data-group-wwr]').forEach((inp) => {
    inp.addEventListener('change', (e) => {
      const gName = e.target.getAttribute('data-group-wwr');
      const pct = Math.min(95, Math.max(5, parseFloat(e.target.value || '60')));
      groupWwrMap[gName] = pct / 100.0;
      scheduleAnalyze();
    });
  });

  tbody.querySelectorAll('[data-group-mat]').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const gName = e.target.getAttribute('data-group-mat');
      if (e.target.value) groupMaterialMap[gName] = e.target.value;
      else delete groupMaterialMap[gName];
      scheduleAnalyze();
    });
  });
}

function renderDynamicFloorPresets(data) {
  const presets = data.dynamic_floor_presets || [];
  const leftBar = document.getElementById('dynamic-floor-presets-bar');
  const cardBar = document.getElementById('dynamic-floor-presets-card-bar');

  const buildBtns = (list) =>
    list
      .map((p) => {
        const fMin = p.min_floor ?? p.floor_min ?? 1;
        const fMax = p.max_floor ?? p.floor_max ?? 1;
        return `
      <button type="button" data-dyn-fmin="${fMin}" data-dyn-fmax="${fMax}" class="studio-input px-2 py-0.5 rounded-md text-[10px] font-mono hover:opacity-80 transition">
        ${p.label}
      </button>
    `;
      })
      .join('');

  if (leftBar) leftBar.innerHTML = buildBtns(presets);
  if (cardBar) cardBar.innerHTML = buildBtns(presets.slice(1)); // exclude duplicate 'Utuh' next to Reset button

  [leftBar, cardBar].forEach((container) => {
    if (!container) return;
    container.querySelectorAll('[data-dyn-fmin]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fMin = parseInt(btn.getAttribute('data-dyn-fmin'), 10);
        const fMax = parseInt(btn.getAttribute('data-dyn-fmax'), 10);
        const sMin = document.getElementById('slider-floor-min');
        const sMax = document.getElementById('slider-floor-max');
        const modeSel = document.getElementById('select-floor-mode');
        if (sMin && sMax) {
          sMin.value = String(fMin);
          sMax.value = String(fMax);
        }
        if (modeSel) {
          modeSel.value = fMin === fMax ? 'single' : fMin === 1 && fMax === (data.summary?.total_floors || 24) ? 'all' : 'range';
        }
        applyFloorSectionState();
      });
    });
  });
}

function renderCustomFloorZonesEditor() {
  const listEl = document.getElementById('custom-floor-zones-list');
  if (!listEl) return;

  listEl.innerHTML = customFloorZones
    .map(
      (z, idx) => `
    <div class="grid grid-cols-12 gap-1 items-center">
      <input type="text" data-cz-name="${idx}" value="${z.name}" class="col-span-5 studio-input rounded px-1.5 py-0.5 text-[10px]" placeholder="Nama Zona" />
      <input type="number" data-cz-from="${idx}" min="1" max="200" value="${z.floor_from}" class="col-span-2 studio-input rounded px-1 py-0.5 text-[10px] text-center" title="Dari Lantai" />
      <input type="number" data-cz-to="${idx}" min="1" max="200" value="${z.floor_to}" class="col-span-2 studio-input rounded px-1 py-0.5 text-[10px] text-center" title="Sampai Lantai" />
      <input type="number" data-cz-h="${idx}" min="2.0" max="15.0" step="0.1" value="${z.height_m}" class="col-span-2 studio-input rounded px-1 py-0.5 text-[10px] text-right" title="Tinggi per Lantai (m)" />
      <button type="button" data-cz-del="${idx}" class="col-span-1 text-rose-600 font-bold hover:opacity-75 text-center" title="Hapus">&times;</button>
    </div>
  `
    )
    .join('');

  listEl.querySelectorAll('[data-cz-name]').forEach((el) => {
    el.addEventListener('input', (e) => {
      customFloorZones[Number(e.target.getAttribute('data-cz-name'))].name = e.target.value;
    });
  });
  listEl.querySelectorAll('[data-cz-from]').forEach((el) => {
    el.addEventListener('change', (e) => {
      customFloorZones[Number(e.target.getAttribute('data-cz-from'))].floor_from = parseInt(e.target.value || '1', 10);
    });
  });
  listEl.querySelectorAll('[data-cz-to]').forEach((el) => {
    el.addEventListener('change', (e) => {
      customFloorZones[Number(e.target.getAttribute('data-cz-to'))].floor_to = parseInt(e.target.value || '1', 10);
    });
  });
  listEl.querySelectorAll('[data-cz-h]').forEach((el) => {
    el.addEventListener('change', (e) => {
      customFloorZones[Number(e.target.getAttribute('data-cz-h'))].height_m = parseFloat(e.target.value || '3.6');
    });
  });
  listEl.querySelectorAll('[data-cz-del]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const idx = Number(e.target.getAttribute('data-cz-del'));
      if (customFloorZones.length > 1) {
        customFloorZones.splice(idx, 1);
        renderCustomFloorZonesEditor();
      }
    });
  });
}

function renderFloorsTable(data) {
  const floors = data.floor_breakdown || [];
  const fSum = data.summary || {};
  const totalF = fSum.total_floors || floors.length || 1;
  const badge = document.getElementById('floor-total-badge');
  if (badge && fSum.total_floors) {
    badge.textContent = `${fSum.total_floors} Lantai (${fSum.z_min_m}–${fSum.z_max_m}m)`;
  }

  const sMin = document.getElementById('slider-floor-min');
  const sMax = document.getElementById('slider-floor-max');
  if (sMin && sMax && fSum.total_floors) {
    sMin.max = String(fSum.total_floors);
    sMax.max = String(fSum.total_floors);
    if (parseInt(sMax.value, 10) > fSum.total_floors) {
      sMax.value = String(fSum.total_floors);
    }
    if (parseInt(sMin.value, 10) > fSum.total_floors) {
      sMin.value = '1';
    }
  }

  const minActive = parseInt(sMin?.value || '1', 10);
  const maxActive = parseInt(sMax?.value || String(totalF), 10);

  const tbody = document.getElementById('table-floors-body');
  if (!tbody) return;

  // Render from top floor down to L1 like a true architectural building elevation
  const floorsReversed = [...floors].sort((a, b) => b.floor_number - a.floor_number);

  tbody.innerHTML = floorsReversed
    .map((f) => {
      const flNum = f.floor_number;
      const inRange = flNum >= minActive && flNum <= maxActive;
      const badgeLabel = f.zone_type || f.zone_badge || 'Tipikal';
      const isVoid = f.total_area_m2 < 1.0 || badgeLabel.includes('Void') || badgeLabel.includes('Terbuka');
      const over = f.ottv_floor_wm2 > 35.0;
      const barPct = Math.min(100, Math.max(0, (f.ottv_floor_wm2 / 48.0) * 100));
      const limitLinePct = (35.0 / 48.0) * 100;

      let zoneBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] studio-subtle opacity-80">${badgeLabel}</span>`;
      if (isVoid) {
        zoneBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] bg-teal-100 text-teal-900 dark:bg-teal-900/50 dark:text-teal-200 font-semibold">${badgeLabel}</span>`;
      } else if (badgeLabel.includes('Puncak') || badgeLabel.includes('Crown') || badgeLabel.includes('Lobby')) {
        zoneBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200 font-semibold">${badgeLabel}</span>`;
      }

      const barColor = isVoid
        ? 'bg-teal-500'
        : over
        ? 'bg-rose-500'
        : f.ottv_floor_wm2 > 30.0
        ? 'bg-amber-500'
        : 'bg-emerald-600';

      return `
      <tr class="transition ${inRange ? 'hover:opacity-95' : 'opacity-40'}">
        <td class="py-1.5 px-2.5 flex items-center gap-1.5">
          <span class="font-bold w-8">L${flNum}</span>
          ${zoneBadge}
        </td>
        <td class="py-1.5 px-2 opacity-75 text-[10px]">${f.z_min.toFixed(1)}–${f.z_max.toFixed(1)}m</td>
        <td class="py-1.5 px-2 text-right">${f.total_area_m2.toFixed(1)}</td>
        <td class="py-1.5 px-2 text-right">${(f.wwr * 100).toFixed(0)}%</td>
        <td class="py-1.5 px-2">
          <div class="w-full h-2.5 rounded-full studio-subtle relative overflow-hidden">
            <div class="h-full rounded-full ${barColor}" style="width: ${barPct.toFixed(1)}%;"></div>
            <div class="absolute top-0 bottom-0 w-0.5 bg-rose-600/80" style="left: ${limitLinePct.toFixed(1)}%;" title="Batas SNI 35 W/m²"></div>
          </div>
        </td>
        <td class="py-1.5 px-2 text-right font-bold ${
          over ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'
        }">${isVoid ? '0.00' : f.ottv_floor_wm2.toFixed(2)}</td>
        <td class="py-1.5 px-2.5 text-right">
          <button data-isolate-floor="${flNum}" class="studio-input px-2 py-0.5 rounded text-[10px] font-semibold hover:opacity-80">
            Isolasi L${flNum}
          </button>
        </td>
      </tr>
    `;
    })
    .join('');

  tbody.querySelectorAll('[data-isolate-floor]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fIdx = parseInt(btn.getAttribute('data-isolate-floor'), 10);
      const modeSel = document.getElementById('select-floor-mode');
      if (modeSel) modeSel.value = 'single';
      if (sMin) sMin.value = String(fIdx);
      if (sMax) sMax.value = String(fIdx);
      applyFloorSectionState();
    });
  });
}

function applyFloorSectionState() {
  const sMin = document.getElementById('slider-floor-min');
  const sMax = document.getElementById('slider-floor-max');
  const totalF = currentAnalysisData?.summary?.total_floors || 24;
  let vMin = parseInt(sMin.value, 10);
  let vMax = parseInt(sMax.value, 10);
  if (vMin > vMax) {
    vMax = vMin;
    sMax.value = String(vMax);
  }
  const rangeTxt =
    vMin === 1 && vMax === totalF
      ? `Semua (L1 – L${totalF})`
      : vMin === vMax
      ? `Lantai L${vMin} Saja`
      : `L${vMin} – L${vMax}`;

  const label = document.getElementById('label-active-floors');
  if (label) label.textContent = rangeTxt;
  const pill = document.getElementById('smart-floor-active-pill');
  if (pill) pill.textContent = `Aktif: ${rangeTxt}`;

  if (currentAnalysisData) {
    renderFloorsTable(currentAnalysisData);
  }
  recalculateLiveKPIsFromActivePanels();
  rebuild3DScene(false);
  applyPanelTableFilters();
}

// ============================================================================
// 13. DAFTAR BIDANG FASAD (DETAILED PER-PANEL TABLE)
// ============================================================================
function applyPanelTableFilters() {
  if (!currentAnalysisData) return;
  const panels = currentAnalysisData.panels || [];
  const groupVal = document.getElementById('table-filter-group')?.value || 'all';
  const statusVal = document.getElementById('select-filter-panel-status')?.value || 'all';
  const query = (document.getElementById('input-search-panels')?.value || '').trim().toLowerCase();

  const minFloor = parseInt(document.getElementById('slider-floor-min')?.value || '1', 10);
  const maxFloor = parseInt(document.getElementById('slider-floor-max')?.value || '999', 10);

  filteredPanels = panels.filter((p) => {
    if (p.floor_number < minFloor || p.floor_number > maxFloor) return false;
    if (groupVal !== 'all' && p.group_name !== groupVal) return false;
    if (!isPanelMatchingExposure(p)) return false;

    const active = isPanelActive(p);
    if (statusVal === 'active' && !active) return false;
    if (statusVal === 'inactive' && active) return false;
    if (statusVal === 'tilted' && !(p.verification_label || '').includes('Condong')) return false;

    if (query) {
      const hay = `${p.id} ${p.group_name} ${p.floor_label} ${p.orientation_code} ${p.material_name}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  currentPage = 1;
  renderPanelsTablePage();
}

function renderPanelsTablePage() {
  const tbody = document.getElementById('table-panels-body');
  const sumText = document.getElementById('panel-table-summary-text');
  const pageInd = document.getElementById('panel-page-indicator');
  if (!tbody) return;

  const total = filteredPanels.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredPanels.slice(start, start + PAGE_SIZE);

  if (sumText) {
    sumText.textContent = `${total.toLocaleString('id-ID')} bidang · nilai per bidang dihitung juga untuk kandidat nonaktif`;
  }
  if (pageInd) {
    pageInd.textContent = `${currentPage} / ${totalPages}`;
  }

  tbody.innerHTML = pageItems
    .map((p) => {
      const checked = isPanelActive(p);
      const isSelected = lockedPanelId === p.id;
      const wwrStr = `${Math.round((p.wwr_panel || 0) * 100)}%`;
      const areaStr = p.area_m2.toFixed(2).replace('.', ',');
      const azStr = `${p.azimuth_deg.toFixed(1).replace('.', ',')}° (${p.orientation_code})`;
      const tiltStr = `${p.tilt_deg.toFixed(1).replace('.', ',')}°`;
      const compVal = p.ottv_composite_wm2 ?? p.ottv_panel_wm2;
      const ottvStr = `${compVal.toFixed(2).replace('.', ',')} (${p.ottv_panel_wm2.toFixed(1).replace('.', ',')})`;

      return `
      <tr data-panel-row="${p.id}" class="cursor-pointer transition hover:opacity-90 ${
        isSelected ? 'selected-row' : ''
      }">
        <td class="py-2.5 pr-2" onclick="event.stopPropagation()">
          <input type="checkbox" data-panel-check="${p.id}" ${
        checked ? 'checked' : ''
      } class="w-4 h-4 accent-emerald-700 rounded cursor-pointer" />
        </td>
        <td class="py-2.5 px-2">
          <div class="font-bold">${p.id}</div>
          <div class="text-[11px] opacity-65">${p.group_name} &middot; ${p.floor_label}</div>
        </td>
        <td class="py-2.5 px-2">
          <div class="font-semibold">${
            p.element_subrole === 'composite_cw'
              ? 'CW Komposit'
              : p.element_type === 'glazing'
              ? 'Kaca Bukaan'
              : 'Spandrel/Dinding'
          }</div>
          <div class="text-[10px] opacity-65 truncate max-w-[190px]">${p.material_name || ''}</div>
        </td>
        <td class="py-2.5 px-2 text-right">${areaStr}</td>
        <td class="py-2.5 px-2 text-right">${azStr}</td>
        <td class="py-2.5 px-2 text-right">${tiltStr}</td>
        <td class="py-2.5 px-2 text-right">${wwrStr}</td>
        <td class="py-2.5 px-2 text-right">${p.sc_effective.toFixed(2)}</td>
        <td class="py-2.5 px-2 text-right font-bold">${ottvStr}</td>
        <td class="py-2.5 pl-2 text-right">
          <span class="px-2 py-0.5 rounded-md text-[10px] studio-subtle font-medium">
            ${p.verification_label || 'OK'}
          </span>
        </td>
      </tr>
    `;
    })
    .join('');

  tbody.querySelectorAll('[data-panel-check]').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const pid = e.target.getAttribute('data-panel-check');
      manualPanelActiveMap.set(pid, e.target.checked);
      recalculateLiveKPIsFromActivePanels();
      rebuild3DScene(false);
    });
  });

  tbody.querySelectorAll('[data-panel-row]').forEach((row) => {
    row.addEventListener('click', () => {
      const pid = row.getAttribute('data-panel-row');
      selectAndLockPanel(pid, true);
    });
  });
}

// ============================================================================
// 14. INDONESIAN MATERIAL LIBRARY, ORIENTATION OVERRIDES & BRAND RECOMMENDER
// ============================================================================
async function loadMaterialsAndLocations() {
  try {
    const [matRes, locRes, preRes] = await Promise.all([
      fetch('/api/materials'),
      fetch('/api/locations'),
      fetch('/api/presets'),
    ]);
    if (matRes.ok) {
      const matJson = await matRes.json();
      materialsCatalog = matJson.materials || [];
      populateMaterialSelects();
      renderOrientationOverridesGrid();
      renderMaterialLibraryTable();
    }
    if (locRes.ok) {
      const locJson = await locRes.json();
      locationsCatalog = locJson.cities || [];
    }
    if (preRes.ok) {
      const preJson = await preRes.json();
      populateDynamicModelSelect(preJson.presets || [], currentPresetId);
    }
  } catch (e) {
    console.error('Failed loading catalogs:', e);
  }
}

function populateMaterialSelects() {
  const selGlazing = document.getElementById('select-mat-glazing');
  const selWall = document.getElementById('select-mat-wall');
  const selFrame = document.getElementById('select-mat-frame');

  const glazings = materialsCatalog.filter((m) => m.category === 'glazing');
  const walls = materialsCatalog.filter((m) => m.category === 'wall');
  const frames = materialsCatalog.filter((m) => m.category === 'frame');

  if (selGlazing) {
    const cur = selGlazing.value || 'glz_saint_gobain_xtreme_60_28';
    selGlazing.innerHTML = glazings
      .map(
        (m) =>
          `<option value="${m.id}" ${m.id === cur ? 'selected' : ''}>${m.brand} — ${m.name} (U=${m.u_value}, SC=${m.sc})</option>`
      )
      .join('');
  }

  if (selWall) {
    const cur = selWall.value || 'wal_spandrel_rockwool_nichias_50';
    selWall.innerHTML = walls
      .map(
        (m) =>
          `<option value="${m.id}" ${m.id === cur ? 'selected' : ''}>${m.brand} — ${m.name} (U=${m.u_value}, α=${m.alpha})</option>`
      )
      .join('');
  }

  if (selFrame) {
    const cur = selFrame.value || 'frm_ykkap_schuco_thermal_break';
    selFrame.innerHTML = frames
      .map(
        (m) =>
          `<option value="${m.id}" ${m.id === cur ? 'selected' : ''}>${m.brand} — ${m.name} (U=${m.u_value})</option>`
      )
      .join('');
  }
}

function renderOrientationOverridesGrid() {
  const grid = document.getElementById('orientation-override-grid');
  if (!grid) return;
  const glazings = materialsCatalog.filter((m) => m.category === 'glazing');
  const oriCodes = ['U', 'TL', 'T', 'TGR', 'S', 'BD', 'B', 'BL'];

  grid.innerHTML = oriCodes
    .map((code) => {
      const selMat = orientationMaterialOverrides[code] || '';
      const opts =
        `<option value="">Ikuti Layer</option>` +
        glazings
          .map(
            (m) =>
              `<option value="${m.id}" ${selMat === m.id ? 'selected' : ''}>${m.brand.split(' ')[0]} · SC ${m.sc}</option>`
          )
          .join('');
      return `
      <div class="studio-card p-1.5 rounded-lg">
        <label class="block text-[10px] font-bold mb-0.5">${code} (${ORIENTATION_META[code]?.angle ?? 0}°)</label>
        <select data-ori-mat="${code}" class="studio-input w-full rounded px-1 py-0.5 text-[10px]">
          ${opts}
        </select>
      </div>
    `;
    })
    .join('');

  grid.querySelectorAll('[data-ori-mat]').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const code = e.target.getAttribute('data-ori-mat');
      if (e.target.value) orientationMaterialOverrides[code] = e.target.value;
      else delete orientationMaterialOverrides[code];
      scheduleAnalyze();
    });
  });
}

function renderMaterialLibraryTable() {
  const tbody = document.getElementById('table-material-library');
  const catFilter = document.getElementById('filter-lib-cat')?.value || 'all';
  if (!tbody) return;

  const list = materialsCatalog.filter((m) => catFilter === 'all' || m.category === catFilter);
  tbody.innerHTML = list
    .map((m) => {
      const scOrAlpha = m.category === 'glazing' ? `SC: ${m.sc}` : `α: ${m.alpha ?? '—'}`;
      return `
      <tr class="hover:opacity-90">
        <td class="py-1.5 px-2.5">
          <div class="font-bold">${m.name}</div>
          <div class="text-[10px] opacity-70">${m.brand}</div>
        </td>
        <td class="py-1.5 px-2 text-[10px]">${m.technology}</td>
        <td class="py-1.5 px-2 text-right font-bold">${Number(m.u_value).toFixed(2)}</td>
        <td class="py-1.5 px-2 text-right">${scOrAlpha}</td>
        <td class="py-1.5 px-2 text-[10px] opacity-80">${m.market_availability || 'Indonesia'}</td>
        <td class="py-1.5 px-2.5 text-right">
          <button data-apply-mat="${m.id}" class="studio-input px-2 py-0.5 rounded text-[10px] font-semibold hover:opacity-80">
            Pakai Template
          </button>
        </td>
      </tr>
    `;
    })
    .join('');

  tbody.querySelectorAll('[data-apply-mat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mid = btn.getAttribute('data-apply-mat');
      const mat = materialsCatalog.find((x) => x.id === mid);
      if (!mat) return;
      applyMaterialToControls(mat);
      scheduleAnalyze();
    });
  });
}

function applyMaterialToControls(mat) {
  if (mat.category === 'glazing') {
    const sel = document.getElementById('select-mat-glazing');
    if (sel) sel.value = mat.id;
    document.getElementById('param-sc-glass').value = String(mat.sc);
    document.getElementById('val-sc-glass').textContent = Number(mat.sc).toFixed(2);
    document.getElementById('param-u-fen').value = String(mat.u_value);
    document.getElementById('val-u-fen').textContent = `${Number(mat.u_value).toFixed(2)} W/m²K`;
    // Update any glazing groups bound in groupMaterialMap
    if (currentAnalysisData?.groups) {
      for (const g of currentAnalysisData.groups) {
        const effCat = groupCategoryOverrides[g.group_name] || g.category;
        if (effCat === 'glazing' || effCat === 'composite_cw') {
          groupMaterialMap[g.group_name] = mat.id;
        }
      }
    }
  } else if (mat.category === 'wall') {
    const sel = document.getElementById('select-mat-wall');
    if (sel) sel.value = mat.id;
    document.getElementById('param-u-wall').value = String(mat.u_value);
    document.getElementById('val-u-wall').textContent = `${Number(mat.u_value).toFixed(2)} W/m²K`;
    document.getElementById('param-alpha-wall').value = String(mat.alpha);
    document.getElementById('val-alpha-wall').textContent = Number(mat.alpha).toFixed(2);
    if (currentAnalysisData?.groups) {
      for (const g of currentAnalysisData.groups) {
        const effCat = groupCategoryOverrides[g.group_name] || g.category;
        if (effCat === 'wall' || effCat === 'spandrel') {
          groupMaterialMap[g.group_name] = mat.id;
        }
      }
    }
  } else if (mat.category === 'frame') {
    const sel = document.getElementById('select-mat-frame');
    if (sel) sel.value = mat.id;
  }
}

function renderRecommendationsGrid(recommendations) {
  const grid = document.getElementById('recommendations-grid');
  if (!grid || !recommendations) return;

  grid.innerHTML = recommendations
    .map(
      (rec) => `
    <div class="studio-subtle rounded-xl p-4 flex flex-col justify-between space-y-3 border" style="border-color: var(--border-color);">
      <div class="space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200">
            Est. OTTV: ${rec.estimated_ottv_wm2.toFixed(2)} W/m²
          </span>
          <span class="text-[10px] font-mono font-semibold text-emerald-700 dark:text-emerald-400 truncate">${rec.badge}</span>
        </div>
        <h3 class="text-xs font-bold">${rec.tier}</h3>
        <div class="text-[11px] space-y-1 pt-1 font-mono">
          <div><strong>Kaca:</strong> ${rec.glazing_brand}</div>
          <div><strong>Dinding/Spandrel:</strong> ${rec.wall_brand}</div>
          <div><strong>Rangka:</strong> ${rec.frame_brand}</div>
        </div>
        <ul class="text-[11px] opacity-75 pt-1 list-disc list-inside space-y-0.5">
          ${(rec.highlights || []).map((h) => `<li>${h}</li>`).join('')}
        </ul>
      </div>
      <button data-rec-glazing="${rec.glazing_material_id}" data-rec-wall="${rec.wall_material_id}" data-rec-frame="${rec.frame_material_id}" class="w-full py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-white text-xs font-semibold transition">
        Terapkan Paket Rekomendasi Ini
      </button>
    </div>
  `
    )
    .join('');

  grid.querySelectorAll('[data-rec-glazing]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gId = btn.getAttribute('data-rec-glazing');
      const wId = btn.getAttribute('data-rec-wall');
      const fId = btn.getAttribute('data-rec-frame');
      const gMat = materialsCatalog.find((m) => m.id === gId);
      const wMat = materialsCatalog.find((m) => m.id === wId);
      const fMat = materialsCatalog.find((m) => m.id === fId);
      if (gMat) applyMaterialToControls(gMat);
      if (wMat) applyMaterialToControls(wMat);
      if (fMat) applyMaterialToControls(fMat);
      scheduleAnalyze();
    });
  });
}

// ============================================================================
// 15. BACKEND API INTEGRATION & OFFICIAL PUPR EXCEL EXPORT
// ============================================================================
function buildCurrentPayloadParams() {
  const floorMode = document.getElementById('select-floor-detection-mode')?.value || 'auto';
  return {
    preset_id: currentPresetId,
    // Stage 1 + v5.0 Staging Profile
    source_software: currentSourceSoftware,
    unit_mode: document.getElementById('select-unit-mode')?.value || 'auto',
    up_axis: document.getElementById('select-up-axis')?.value || 'auto',
    exterior_detection_mode: document.getElementById('select-exterior-mode')?.value || 'auto',
    z_ground_cutoff_m: currentZGroundCutoff,
    outer_skin_only: document.getElementById('chk-outer-skin-only')?.checked ?? true,
    // Stage 2
    auto_split_merged_cw: document.getElementById('chk-auto-split-cw')?.checked ?? false,
    groups_to_auto_split: Array.from(groupsToAutoSplit),
    frame_width_threshold_m: parseFloat(document.getElementById('input-frame-width-thresh')?.value || '0.28'),
    spandrel_height_threshold_m: parseFloat(document.getElementById('input-spandrel-height-thresh')?.value || '1.15'),
    disabled_groups: Array.from(disabledGroups),
    group_category_overrides: groupCategoryOverrides,
    group_wwr_map: groupWwrMap,
    face_category_overrides: faceCategoryOverrides,
    face_z_band_overrides: faceZBandOverrides,
    // Stage 3
    floor_mode: floorMode,
    floor_height_m: parseFloat(document.getElementById('input-floor-height')?.value || '3.6'),
    custom_floor_zones: floorMode === 'custom' ? customFloorZones : [],
    // Stage 4
    group_material_map: groupMaterialMap,
    orientation_material_overrides: orientationMaterialOverrides,
    use_global_slider_override: document.getElementById('chk-global-slider-override')?.checked ?? false,
    alpha_wall: parseFloat(document.getElementById('param-alpha-wall')?.value || '0.42'),
    u_wall: parseFloat(document.getElementById('param-u-wall')?.value || '0.62'),
    td_ek: 15.0,
    u_fenestration: parseFloat(document.getElementById('param-u-fen')?.value || '1.10'),
    delta_t: 5.0,
    sc_glass: parseFloat(document.getElementById('param-sc-glass')?.value || '0.23'),
    include_frame_conduction: document.getElementById('chk-frame-conduction')?.checked ?? true,
    glazing_material_id: document.getElementById('select-mat-glazing')?.value || 'glz_saint_gobain_xtreme_60_28',
    wall_material_id: document.getElementById('select-mat-wall')?.value || 'wal_spandrel_rockwool_nichias_50',
    frame_material_id: document.getElementById('select-mat-frame')?.value || 'frm_ykkap_schuco_thermal_break',
    enable_parametric_louvers: document.getElementById('param-enable-louvers')?.checked ?? false,
    louver_depth_m: 0.65,
    north_angle_deg: currentNorthAngle,
    city_preset: document.getElementById('select-city-epw')?.value || 'jakarta',
  };
}

function scheduleAnalyze() {
  if (!currentPresetId) return;
  if (analyzeDebounceTimer) clearTimeout(analyzeDebounceTimer);
  analyzeDebounceTimer = setTimeout(() => {
    runAnalysis(false);
  }, 140);
}

async function runAnalysis(resetCamera = false, fileToUpload = null) {
  if (!fileToUpload && !currentPresetId) {
    enterEmptyStudioState(
      'Tidak Ada Model Aktif',
      'Pilih salah satu model dari katalog atau impor model baru melalui Ruang Inspeksi untuk memulai perhitungan OTTV.'
    );
    return;
  }
  exitEmptyStudioState();
  const loader = document.getElementById('viewport-loading');
  if (loader) loader.classList.remove('hidden');

  try {
    const params = buildCurrentPayloadParams();
    let response;

    if (fileToUpload) {
      const fd = new FormData();
      fd.append('file', fileToUpload);
      Object.entries(params).forEach(([k, v]) => {
        if (v === null || v === undefined) return;
        if (typeof v === 'object') {
          fd.append(k, JSON.stringify(v));
        } else {
          fd.append(k, String(v));
        }
      });
      response = await fetch('/api/analyze/upload', { method: 'POST', body: fd });
    } else {
      response = await fetch('/api/analyze/preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
    }

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson.detail) errMsg = errJson.detail;
      } catch (_) {}
      throw new Error(errMsg);
    }

    const data = await response.json();
    hydrateAnalysisResponse(data, resetCamera);
  } catch (err) {
    console.error('Analysis error:', err);
    // STRICT UX RULE: Never keep a stale 3D preview of a previous model if loading failed!
    enterEmptyStudioState(
      'Gagal Memuat Model ke Live Preview',
      `Analisa OTTV ditutup agar tidak menampilkan data model sebelumnya. Detail error: ${err.message}`
    );
  } finally {
    if (loader) loader.classList.add('hidden');
  }
}

function hydrateAnalysisResponse(data, resetCamera = false) {
  exitEmptyStudioState();
  currentAnalysisData = data;
  manualPanelActiveMap.clear();

  if (data.preset_id) {
    currentPresetId = data.preset_id;
  }
  if (data.available_models) {
    populateDynamicModelSelect(data.available_models, currentPresetId);
  }
  const fnBadge = document.getElementById('upload-filename-badge');
  if (fnBadge && data.filename) {
    fnBadge.textContent = `Aktif: ${data.filename}`;
  }

  const loc = data.location_info || {};
  document.getElementById('loc-coords').textContent = `${Number(loc.latitude_deg ?? -6.21).toFixed(2)}°, ${Number(
    loc.longitude_deg ?? 106.85
  ).toFixed(2)}°`;
  document.getElementById('loc-temp').textContent = `${Number(loc.mean_temp_c ?? 28.4).toFixed(1)} °C`;
  document.getElementById('loc-dni').textContent = `${loc.peak_dni_wm2 ?? 890} W/m²`;
  document.getElementById('loc-mult').textContent = `${Number(loc.sf_multiplier ?? 1.0).toFixed(2)}× SF`;

  const sum = data.summary || {};
  document.getElementById('summary-total-kw').textContent = `${sum.total_heat_gain_kw || 0} kW`;
  document.getElementById('comp-wall-cond').textContent = (sum.q_wall_conduction_wm2 || 0).toFixed(2);
  document.getElementById('comp-glass-cond').textContent = (sum.q_glass_conduction_wm2 || 0).toFixed(2);
  document.getElementById('comp-solar-rad').textContent = (sum.q_solar_radiation_wm2 || 0).toFixed(2);

  if (resetCamera && sum.total_floors) {
    const sMin = document.getElementById('slider-floor-min');
    const sMax = document.getElementById('slider-floor-max');
    if (sMin && sMax) {
      sMin.max = String(sum.total_floors);
      sMax.max = String(sum.total_floors);
      sMin.value = '1';
      sMax.value = String(sum.total_floors);
    }
    const lbl = document.getElementById('label-active-floors');
    if (lbl) lbl.textContent = `Semua (L1 – L${sum.total_floors})`;
  }

  renderStageGatesAndAudit(data);
  renderGroupsTable(data);
  renderDynamicFloorPresets(data);
  renderFloorsTable(data);
  renderRecommendationsGrid(data.recommendations || []);
  updateChartsAndOrientationTable(data);
  recalculateLiveKPIsFromActivePanels();
  applyPanelTableFilters();
  rebuild3DScene(resetCamera);

  if (!lockedPanelId && data.panels && data.panels.length > 0) {
    const firstActive = data.panels.find((p) => p.is_outer) || data.panels[0];
    populateInspectorCard(firstActive, false);
  }
}

function downloadOfficialPuprExcel() {
  if (!currentPresetId || !currentAnalysisData) {
    alert('Tidak ada model aktif. Pilih atau impor model terlebih dahulu sebelum mengunduh laporan Excel PUPR.');
    return;
  }
  window.open('/api/export/excel', '_blank');
}

function syncNorthAngleControls(newAngle, triggerBackend = true) {
  const norm = ((Math.round(Number(newAngle) || 0) % 360) + 360) % 360;
  currentNorthAngle = norm;

  const slider = document.getElementById('slider-north-angle');
  const numInput = document.getElementById('input-north-angle');
  const cardLabel = document.getElementById('label-north-cardinal');
  const hudLabel = document.getElementById('hud-north-label');

  if (slider) slider.value = String(norm);
  if (numInput) numInput.value = String(norm);
  if (cardLabel) cardLabel.textContent = `Utara: ${norm}°`;
  if (hudLabel) hudLabel.textContent = `Utara: ${norm}°`;

  updateViewportActiveBadge();
  rebuild3DScene(false);
  if (triggerBackend) {
    scheduleAnalyze();
  }
}

// ============================================================================
// 16. BIND ALL UI CONTROLS & EVENT LISTENERS
// ============================================================================
function bindAllEvents() {
  // 1. Light / Dark Mode Theme Toggle
  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const html = document.documentElement;
    const isDark = html.classList.toggle('dark');
    document.getElementById('theme-label').textContent = isDark ? 'Mode Dark' : 'Mode Light';
    document.getElementById('theme-icon').innerHTML = isDark ? '&#9790;' : '&#9728;';

    if (scene) {
      scene.background = new THREE.Color(isDark ? 0x070a12 : 0xf3f4ed);
      buildGroundGrid(isDark);
      rebuild3DScene(false);
    }
    if (currentAnalysisData) {
      updateChartsAndOrientationTable(currentAnalysisData);
    }
    stagingController?.syncThemeBackground();
  });

  // 1b. v5.0 Dedicated Intake & 3D Staging Inspection Workspace Buttons
  const openImport = () => stagingController?.openNewImportView();
  const openReinspect = () => {
    if (!currentPresetId || !currentAnalysisData) return;
    stagingController?.openReinspectActiveModel(currentPresetId, {
      source_software: currentSourceSoftware,
      unit_mode: document.getElementById('select-unit-mode')?.value || 'auto',
      up_axis: document.getElementById('select-up-axis')?.value || 'auto',
      z_ground_cutoff_m: currentZGroundCutoff,
      auto_split_merged_cw: document.getElementById('chk-auto-split-cw')?.checked ?? false,
      groups_to_auto_split: Array.from(groupsToAutoSplit),
      frame_width_threshold_m: parseFloat(document.getElementById('input-frame-width-thresh')?.value || '0.28'),
      spandrel_height_threshold_m: parseFloat(document.getElementById('input-spandrel-height-thresh')?.value || '1.15'),
      group_category_overrides: groupCategoryOverrides,
      disabled_groups: Array.from(disabledGroups),
      group_wwr_map: groupWwrMap,
      face_category_overrides: faceCategoryOverrides,
      face_z_band_overrides: faceZBandOverrides,
    });
  };
  document.getElementById('btn-open-staging-import')?.addEventListener('click', openImport);
  document.getElementById('btn-stage1-open-intake')?.addEventListener('click', openImport);
  document.getElementById('btn-empty-import-new')?.addEventListener('click', openImport);
  document.getElementById('btn-open-staging-reinspect')?.addEventListener('click', openReinspect);
  document.getElementById('btn-stage1-reinspect')?.addEventListener('click', openReinspect);

  document.getElementById('btn-close-active-model')?.addEventListener('click', () => {
    enterEmptyStudioState(
      'Model Aktif Ditutup',
      'Live Preview 3D dan seluruh perhitungan OTTV dinonaktifkan. Pilih sampel dari katalog model atau impor model baru untuk memulai sesi analisa baru.'
    );
  });

  document.getElementById('btn-empty-open-catalog')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('model-dropdown-menu');
    const trig = document.getElementById('btn-model-dropdown');
    menu?.classList.remove('hidden');
    trig?.setAttribute('aria-expanded', 'true');
    trig?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // 2. Camera Projection Switch (Perspektif <-> Aksonometri) & Camera Snap Buttons
  document.getElementById('btn-cam-persp')?.addEventListener('click', () => setCameraProjectionMode('perspective'));
  document.getElementById('btn-cam-axon')?.addEventListener('click', () => setCameraProjectionMode('axonometric'));

  document.getElementById('btn-view-iso')?.addEventListener('click', () => {
    setCameraProjectionMode(cameraMode === 'perspective' ? 'axonometric' : 'perspective');
    fitCameraToModel();
  });

  document.getElementById('btn-reset-camera')?.addEventListener('click', () => fitCameraToModel());
  document.getElementById('btn-view-top')?.addEventListener('click', () => {
    const bbox = currentAnalysisData?.summary?.bounding_box || { center: [0, 0, 42], max_span: 86 };
    controls.target.set(bbox.center[0], bbox.center[1], bbox.center[2]);
    camera.position.set(bbox.center[0], bbox.center[1] - 0.5, (bbox.max_span || 86) * 2.15);
    controls.update();
  });

  // 3. Interactive Building Orientation (North Angle 0..360°)
  document.getElementById('slider-north-angle')?.addEventListener('input', (e) => {
    syncNorthAngleControls(e.target.value, true);
  });
  document.getElementById('input-north-angle')?.addEventListener('change', (e) => {
    syncNorthAngleControls(e.target.value, true);
  });
  document.getElementById('btn-north-minus45')?.addEventListener('click', () => {
    syncNorthAngleControls(currentNorthAngle - 45, true);
  });
  document.getElementById('btn-north-reset')?.addEventListener('click', () => {
    syncNorthAngleControls(0, true);
  });
  document.getElementById('btn-north-plus45')?.addEventListener('click', () => {
    syncNorthAngleControls(currentNorthAngle + 45, true);
  });

  // 3b. Collapsible Glassmorphism HUD Dock inside 3D Live Preview Canvas
  document.getElementById('btn-toggle-canvas-hud')?.addEventListener('click', () => {
    const body = document.getElementById('canvas-sun-compass-body');
    const btn = document.getElementById('btn-toggle-canvas-hud');
    if (!body || !btn) return;
    const isNowHidden = body.classList.toggle('hidden');
    btn.innerHTML = isNowHidden ? 'Tampilkan Kontrol &#9652;' : 'Sembunyikan &#9662;';
  });

  // 3c. Custom Model Switcher Dropdown Toggle (Click-outside & Escape close)
  document.getElementById('btn-model-dropdown')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('model-dropdown-menu');
    const trig = document.getElementById('btn-model-dropdown');
    if (!menu) return;
    const isNowHidden = menu.classList.toggle('hidden');
    trig?.setAttribute('aria-expanded', String(!isNowHidden));
  });
  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('model-dropdown-wrapper');
    if (wrap && !wrap.contains(e.target)) {
      closeModelDropdownMenu();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModelDropdownMenu();
  });

  // 4. Proportional 3D Sun-Path Dome Radius & Solar Hour Controls
  document.getElementById('slider-dome-radius')?.addEventListener('input', () => {
    rebuild3DScene(false);
  });
  document.getElementById('select-solar-hour')?.addEventListener('change', () => {
    rebuild3DScene(false);
    if (activeExposureDirection === 'SUNLIT_HOUR') {
      applyPanelTableFilters();
    }
  });

  // 5. 8-Direction Solar Exposure Selector Pills
  document.querySelectorAll('[data-dir-pill]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const code = btn.getAttribute('data-dir-pill');
      setActiveExposureDirection(code);
    });
  });
  document.getElementById('chk-exposure-isolate')?.addEventListener('change', () => rebuild3DScene(false));

  // 6. Color Mode & Heatmap Sub-Mode Selectors
  document.getElementById('select-color-mode')?.addEventListener('change', () => rebuild3DScene(false));
  document.getElementById('select-heatmap-submode')?.addEventListener('change', () => rebuild3DScene(false));

  // 7. Dynamic Model & Preset Selector + Stage 1/2 Controls
  document.getElementById('preset-select')?.addEventListener('change', (e) => {
    const nextId = e.target.value;
    if (!nextId) return;
    currentPresetId = nextId;
    resetModelSpecificControls(nextId);
    populateDynamicModelSelect(availableModelsCatalog, currentPresetId);
    const entry = availableModelsCatalog.find((m) => m.id === nextId);
    const fnBadge = document.getElementById('upload-filename-badge');
    if (fnBadge) {
      fnBadge.textContent = `Aktif: ${entry?.filename || entry?.title || currentPresetId}`;
    }
    runAnalysis(true);
  });

  document.getElementById('select-unit-mode')?.addEventListener('change', () => runAnalysis(true));
  document.getElementById('select-up-axis')?.addEventListener('change', () => runAnalysis(true));
  document.getElementById('select-exterior-mode')?.addEventListener('change', () => scheduleAnalyze());
  document.getElementById('chk-auto-split-cw')?.addEventListener('change', () => scheduleAnalyze());
  document.getElementById('input-frame-width-thresh')?.addEventListener('change', () => scheduleAnalyze());
  document.getElementById('input-spandrel-height-thresh')?.addEventListener('change', () => scheduleAnalyze());

  // 8. Universal Multi-Format File Upload (.3dm, .ifc, .obj, .glb, .gltf, .hbjson)
  const fileInput = document.getElementById('file-upload-input');
  const dropzone = document.getElementById('dropzone-area');

  async function handleSelectedFile(file) {
    if (!file) return;
    disabledGroups.clear();
    groupCategoryOverrides = {};
    groupMaterialMap = {};
    groupsToAutoSplit.clear();
    groupWwrMap = {};
    lockedPanelId = null;
    activeExposureDirection = 'ALL';
    document.getElementById('upload-filename-badge').textContent = `Unggahan: ${file.name} (${(
      file.size /
      (1024 * 1024)
    ).toFixed(2)} MB)`;
    inspect3dmFileClientSide(file);
    await runAnalysis(true, file);
    if (fileInput) fileInput.value = '';
  }

  fileInput?.addEventListener('change', (e) => {
    if (e.target.files?.length) handleSelectedFile(e.target.files[0]);
  });

  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('border-emerald-600');
  });
  dropzone?.addEventListener('dragleave', () => {
    dropzone.classList.remove('border-emerald-600');
  });
  dropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('border-emerald-600');
    if (e.dataTransfer?.files?.length) handleSelectedFile(e.dataTransfer.files[0]);
  });

  // 9. Location & EPW Upload / Sample Download
  document.getElementById('select-city-epw')?.addEventListener('change', () => {
    scheduleAnalyze();
  });

  document.getElementById('btn-download-epw')?.addEventListener('click', () => {
    const cityId = document.getElementById('select-city-epw')?.value || 'jakarta';
    window.open(`/api/locations/${cityId}/download-epw`, '_blank');
  });

  document.getElementById('epw-upload-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/locations/upload-epw', { method: 'POST', body: fd });
      if (res.ok) {
        const json = await res.json();
        const epwData = json.location;
        const citySel = document.getElementById('select-city-epw');
        const opt = document.createElement('option');
        opt.value = 'custom_epw';
        opt.textContent = `Custom EPW: ${epwData.city} (Lat ${epwData.latitude_deg}°)`;
        opt.selected = true;
        citySel.prepend(opt);
        scheduleAnalyze();
      }
    } catch (err) {
      console.error('EPW upload error:', err);
    }
  });

  // 10. Stage 3 Dynamic Floor Detection & Section Controls
  renderCustomFloorZonesEditor();

  document.getElementById('select-floor-detection-mode')?.addEventListener('change', (e) => {
    const mode = e.target.value;
    const custPanel = document.getElementById('custom-floor-zones-panel');
    if (custPanel) {
      custPanel.classList.toggle('hidden', mode !== 'custom');
    }
    scheduleAnalyze();
  });

  document.getElementById('btn-add-floor-zone')?.addEventListener('click', () => {
    const last = customFloorZones[customFloorZones.length - 1] || { floor_to: 1, height_m: 3.6 };
    customFloorZones.push({
      name: `Zona Baru ${customFloorZones.length + 1}`,
      floor_from: last.floor_to + 1,
      floor_to: last.floor_to + 5,
      height_m: 3.6,
    });
    renderCustomFloorZonesEditor();
  });

  document.getElementById('btn-apply-floor-zones')?.addEventListener('click', () => {
    scheduleAnalyze();
  });

  document.getElementById('input-floor-height')?.addEventListener('change', () => {
    const detMode = document.getElementById('select-floor-detection-mode');
    if (detMode && detMode.value === 'auto') {
      detMode.value = 'uniform';
    }
    scheduleAnalyze();
  });

  document.getElementById('select-floor-mode')?.addEventListener('change', (e) => {
    const mode = e.target.value;
    const totalF = currentAnalysisData?.summary?.total_floors || 24;
    const sMin = document.getElementById('slider-floor-min');
    const sMax = document.getElementById('slider-floor-max');
    if (!sMin || !sMax) return;
    if (mode === 'single') {
      sMin.value = '1';
      sMax.value = '1';
    } else if (mode === 'all') {
      sMin.value = '1';
      sMax.value = String(totalF);
    }
    applyFloorSectionState();
  });

  document.getElementById('slider-floor-min')?.addEventListener('input', applyFloorSectionState);
  document.getElementById('slider-floor-max')?.addEventListener('input', applyFloorSectionState);
  document.getElementById('chk-show-section-plane')?.addEventListener('change', () => rebuild3DScene(false));

  document.getElementById('btn-floor-prev')?.addEventListener('click', () => {
    const sMin = document.getElementById('slider-floor-min');
    const sMax = document.getElementById('slider-floor-max');
    const cur = Math.max(1, parseInt(sMin.value, 10) - 1);
    sMin.value = String(cur);
    sMax.value = String(cur);
    document.getElementById('select-floor-mode').value = 'single';
    applyFloorSectionState();
  });

  document.getElementById('btn-floor-next')?.addEventListener('click', () => {
    const totalF = currentAnalysisData?.summary?.total_floors || 24;
    const sMin = document.getElementById('slider-floor-min');
    const sMax = document.getElementById('slider-floor-max');
    const cur = Math.min(totalF, parseInt(sMin.value, 10) + 1);
    sMin.value = String(cur);
    sMax.value = String(cur);
    document.getElementById('select-floor-mode').value = 'single';
    applyFloorSectionState();
  });

  document.getElementById('btn-reset-floor-section')?.addEventListener('click', () => {
    const totalF = currentAnalysisData?.summary?.total_floors || 24;
    const sMin = document.getElementById('slider-floor-min');
    const sMax = document.getElementById('slider-floor-max');
    const modeSel = document.getElementById('select-floor-mode');
    if (sMin && sMax) {
      sMin.value = '1';
      sMax.value = String(totalF);
    }
    if (modeSel) modeSel.value = 'all';
    applyFloorSectionState();
  });

  // 11. Stage 4 Material Templates, Orientation Overrides & Sliders
  document.getElementById('btn-clear-ori-overrides')?.addEventListener('click', () => {
    orientationMaterialOverrides = {};
    renderOrientationOverridesGrid();
    scheduleAnalyze();
  });

  document.getElementById('chk-global-slider-override')?.addEventListener('change', () => {
    scheduleAnalyze();
  });

  document.getElementById('select-mat-glazing')?.addEventListener('change', (e) => {
    const mat = materialsCatalog.find((m) => m.id === e.target.value);
    if (mat) applyMaterialToControls(mat);
    scheduleAnalyze();
  });

  document.getElementById('select-mat-wall')?.addEventListener('change', (e) => {
    const mat = materialsCatalog.find((m) => m.id === e.target.value);
    if (mat) applyMaterialToControls(mat);
    scheduleAnalyze();
  });

  document.getElementById('select-mat-frame')?.addEventListener('change', () => {
    scheduleAnalyze();
  });

  const sliderConfigs = [
    ['param-sc-glass', 'val-sc-glass', (v) => Number(v).toFixed(2)],
    ['param-u-fen', 'val-u-fen', (v) => `${Number(v).toFixed(2)} W/m²K`],
    ['param-u-wall', 'val-u-wall', (v) => `${Number(v).toFixed(2)} W/m²K`],
    ['param-alpha-wall', 'val-alpha-wall', (v) => Number(v).toFixed(2)],
  ];
  sliderConfigs.forEach(([id, labelId, fmt]) => {
    const el = document.getElementById(id);
    el?.addEventListener('input', () => {
      document.getElementById(labelId).textContent = fmt(el.value);
      // Automatically enable global slider override when user drags a parametric slider
      const chkGlobal = document.getElementById('chk-global-slider-override');
      if (chkGlobal && !chkGlobal.checked) {
        chkGlobal.checked = true;
      }
      scheduleAnalyze();
    });
  });

  document.getElementById('chk-frame-conduction')?.addEventListener('change', scheduleAnalyze);
  document.getElementById('param-enable-louvers')?.addEventListener('change', scheduleAnalyze);

  // 12. 3D Viewport Layer Checkboxes
  document.getElementById('chk-outer-skin-only')?.addEventListener('change', () => scheduleAnalyze());
  document.getElementById('chk-show-frames')?.addEventListener('change', () => rebuild3DScene(false));
  document.getElementById('chk-show-wireframe')?.addEventListener('change', () => rebuild3DScene(false));
  document.getElementById('chk-show-normals')?.addEventListener('change', () => rebuild3DScene(false));
  document.getElementById('chk-show-rays')?.addEventListener('change', () => rebuild3DScene(false));

  document.getElementById('btn-focus-table-row')?.addEventListener('click', () => {
    document.getElementById('section-panel-table')?.scrollIntoView({ behavior: 'smooth' });
  });

  // 13. Custom Material Creator
  document.getElementById('filter-lib-cat')?.addEventListener('change', renderMaterialLibraryTable);

  document.getElementById('btn-add-custom-mat')?.addEventListener('click', async () => {
    const name = document.getElementById('cust-mat-name').value.trim() || 'Material Custom Arsitektural';
    const brand = document.getElementById('cust-mat-brand').value.trim() || 'Custom Spesifikasi';
    const category = document.getElementById('cust-mat-cat').value;
    const u_value = parseFloat(document.getElementById('cust-mat-u').value || '1.5');
    const scOrAlpha = parseFloat(document.getElementById('cust-mat-sc-alpha').value || '0.3');
    const tdek = parseFloat(document.getElementById('cust-mat-tdek').value || '10.0');
    const thick = parseFloat(document.getElementById('cust-mat-thick').value || '24');

    const payload = {
      name,
      brand,
      category,
      technology: 'Custom User Template',
      u_value,
      sc: category === 'glazing' ? scOrAlpha : undefined,
      alpha: category !== 'glazing' ? scOrAlpha : undefined,
      td_ek: tdek,
      thickness_mm: thick,
    };

    try {
      const res = await fetch('/api/materials/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const json = await res.json();
        materialsCatalog.push(json.material);
        populateMaterialSelects();
        renderOrientationOverridesGrid();
        renderMaterialLibraryTable();
        applyMaterialToControls(json.material);
        scheduleAnalyze();
      }
    } catch (e) {
      console.error('Custom material error:', e);
    }
  });

  // 14. Daftar Bidang Fasad Controls & Pagination
  document.getElementById('table-filter-group')?.addEventListener('change', applyPanelTableFilters);
  document.getElementById('select-filter-panel-status')?.addEventListener('change', applyPanelTableFilters);
  document.getElementById('input-search-panels')?.addEventListener('input', applyPanelTableFilters);

  document.getElementById('btn-enable-outer-guess')?.addEventListener('click', () => {
    manualPanelActiveMap.clear();
    const chk = document.getElementById('chk-outer-skin-only');
    if (chk) chk.checked = true;
    scheduleAnalyze();
  });

  document.getElementById('btn-disable-selected-group')?.addEventListener('click', () => {
    const grp = document.getElementById('table-filter-group')?.value;
    if (grp && grp !== 'all') {
      disabledGroups.add(grp);
      scheduleAnalyze();
    } else {
      filteredPanels.forEach((p) => manualPanelActiveMap.set(p.id, false));
      recalculateLiveKPIsFromActivePanels();
      renderPanelsTablePage();
      rebuild3DScene(false);
    }
  });

  document.getElementById('select-change-group-cat')?.addEventListener('change', (e) => {
    const newCat = e.target.value;
    if (!newCat) return;
    const grp = document.getElementById('table-filter-group')?.value;
    if (grp && grp !== 'all') {
      groupCategoryOverrides[grp] = newCat;
      scheduleAnalyze();
    }
    e.target.value = '';
  });

  document.getElementById('btn-exclude-all-panels')?.addEventListener('click', () => {
    filteredPanels.forEach((p) => manualPanelActiveMap.set(p.id, false));
    recalculateLiveKPIsFromActivePanels();
    renderPanelsTablePage();
    rebuild3DScene(false);
  });

  document.getElementById('btn-page-prev')?.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderPanelsTablePage();
    }
  });

  document.getElementById('btn-page-next')?.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(filteredPanels.length / PAGE_SIZE));
    if (currentPage < totalPages) {
      currentPage++;
      renderPanelsTablePage();
    }
  });

  // 15. Stage 5 Official Report Export Button (PUPR Excel Only)
  ['btn-export-excel', 'btn-table-excel'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', downloadOfficialPuprExcel);
  });
}

// ============================================================================
// BOOTSTRAP STUDIO APPLICATION (v5.0 MULTI-ADAPTER VIEW 1 <-> VIEW 2)
// ============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  initThreeViewport();

  stagingController = new StagingWorkspaceController({
    getStudioThermalPrefs: () => ({
      glazing_material_id: document.getElementById('select-mat-glazing')?.value || 'glz_saint_gobain_xtreme_60_28',
      wall_material_id: document.getElementById('select-mat-wall')?.value || 'wal_spandrel_rockwool_nichias_50',
      frame_material_id: document.getElementById('select-mat-frame')?.value || 'frm_ykkap_schuco_thermal_break',
      north_angle_deg: currentNorthAngle,
      city_preset: document.getElementById('select-city-epw')?.value || 'jakarta',
      outer_skin_only: document.getElementById('chk-outer-skin-only')?.checked ?? true,
    }),
    onReturnToStudio: () => {
      // Ensure View 2 Three.js viewport resizes cleanly after returning from View 1
      window.dispatchEvent(new Event('resize'));
    },
    onCommitResult: (ottvData, stgState) => {
      // Sync verified View 1 staging state into View 2 controls
      currentPresetId = ottvData.preset_id || stgState.model_id || currentPresetId;
      currentSourceSoftware = stgState.source_software || 'archicad';
      currentZGroundCutoff = Number(stgState.z_ground_cutoff_m || 0);
      groupCategoryOverrides = { ...(stgState.group_category_overrides || {}) };
      disabledGroups = new Set(stgState.disabled_groups || []);
      groupsToAutoSplit = new Set(stgState.groups_to_auto_split || []);
      groupWwrMap = { ...(stgState.group_wwr_map || {}) };
      faceCategoryOverrides = { ...(stgState.face_category_overrides || {}) };
      faceZBandOverrides = [...(stgState.face_z_band_overrides || [])];
      lockedPanelId = null;

      const uSel = document.getElementById('select-unit-mode');
      if (uSel) uSel.value = stgState.unit_mode || 'auto';
      const axSel = document.getElementById('select-up-axis');
      if (axSel) axSel.value = stgState.up_axis || 'auto';
      const chkSplit = document.getElementById('chk-auto-split-cw');
      if (chkSplit) chkSplit.checked = Boolean(stgState.auto_split_merged_cw);

      window.dispatchEvent(new Event('resize'));
      hydrateAnalysisResponse(ottvData, true);
    },
  });

  bindAllEvents();
  await Promise.all([initRhino3dmWasm(), loadMaterialsAndLocations(), stagingController.init()]);
  await runAnalysis(true);
});
