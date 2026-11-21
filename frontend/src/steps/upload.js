/**
 * Screen 1: Unggah (`docs/FASE4_UI_SPEC.md` §3.1 + mockup 1-unggah.html).
 * Note per spec §3.1: Before Fase 5, disclaimer explicitly states
 * "Model diproses di server LUXA dan tidak dibagikan." (never claims browser-only yet).
 */

import { icon } from '../ui/icons.js';

export function renderUploadScreen(state, handlers) {
  const main = document.createElement('main');
  main.className = 'main main-upload';

  // Left: Drag-and-drop zone
  const dropSection = document.createElement('section');
  dropSection.className = 'box upload-dropzone';
  dropSection.setAttribute('aria-labelledby', 'up-title');

  const inner = document.createElement('div');
  inner.className = 'upload-inner';

  const iconBox = document.createElement('div');
  iconBox.className = 'upload-icon-box';
  iconBox.innerHTML = icon('upload', 34);

  const title = document.createElement('h1');
  title.id = 'up-title';
  title.className = 'upload-title';
  title.textContent = 'Seret model 3D ke sini';

  const desc = document.createElement('p');
  desc.className = 'muted';
  desc.style.margin = '0';
  desc.textContent =
    'Satu file per proyek. Aplikasi membaca satuan, sumbu, dan klasifikasi tiap grup, lalu meminta kamu mengonfirmasi sebelum menghitung.';

  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '8px';
  btnRow.style.flexWrap = 'wrap';
  btnRow.style.justifyContent = 'center';

  const fileInput = document.createElement('input');
  fileInput.id = 'luxa-file-model';
  fileInput.type = 'file';
  fileInput.accept = '.3dm,.ifc,.obj,.glb,.gltf,.zip,.hbjson';
  fileInput.style.position = 'absolute';
  fileInput.style.width = '1px';
  fileInput.style.height = '1px';
  fileInput.style.opacity = '0';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handlers.onUploadFile(file);
    fileInput.value = '';
  });

  const fileLabel = document.createElement('label');
  fileLabel.className = 'cta';
  fileLabel.htmlFor = 'luxa-file-model';
  fileLabel.innerHTML = `${icon('upload', 18)}<span>Pilih file model</span>`;

  const projInput = document.createElement('input');
  projInput.id = 'luxa-file-project';
  projInput.type = 'file';
  projInput.accept = '.json,.ottv.json';
  projInput.style.position = 'absolute';
  projInput.style.width = '1px';
  projInput.style.height = '1px';
  projInput.style.opacity = '0';
  projInput.addEventListener('change', () => {
    const file = projInput.files?.[0];
    if (file) handlers.onOpenProjectFile(file);
    projInput.value = '';
  });

  const projBtn = document.createElement('button');
  projBtn.type = 'button';
  projBtn.className = 'ghost';
  projBtn.textContent = 'Buka proyek tersimpan (.ottv.json)';
  projBtn.addEventListener('click', () => projInput.click());

  btnRow.append(fileLabel, fileInput, projBtn, projInput);

  const fmtHint = document.createElement('p');
  fmtHint.className = 'lbl';
  fmtHint.style.margin = '6px 0 0';
  fmtHint.textContent = '.3dm Rhino 7/8 · .ifc IFC2x3, IFC4, IFC4.3 · .obj + .mtl · .glb';

  const sizeHint = document.createElement('p');
  sizeHint.className = 'lbl';
  sizeHint.style.margin = '0';
  sizeHint.textContent = 'File di atas 50 MB bisa butuh lebih dari satu menit.';

  inner.append(iconBox, title, desc, btnRow, fmtHint, sizeHint);

  if (handlers.savedAutosave?.modelId) {
    const resumeBtn = document.createElement('button');
    resumeBtn.type = 'button';
    resumeBtn.className = 'ghost ghost-sm';
    resumeBtn.style.marginTop = '8px';
    resumeBtn.textContent = `Lanjutkan sesi terakhir: ${handlers.savedAutosave.filename || handlers.savedAutosave.modelId}`;
    resumeBtn.addEventListener('click', () => handlers.onResumeAutosave(handlers.savedAutosave));
    inner.appendChild(resumeBtn);
  }

  dropSection.appendChild(inner);

  // Drag & drop handlers
  const stopDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  dropSection.addEventListener('dragenter', (e) => {
    stopDrag(e);
    dropSection.classList.add('is-dragover');
  });
  dropSection.addEventListener('dragover', (e) => {
    stopDrag(e);
    dropSection.classList.add('is-dragover');
  });
  dropSection.addEventListener('dragleave', (e) => {
    stopDrag(e);
    dropSection.classList.remove('is-dragover');
  });
  dropSection.addEventListener('drop', (e) => {
    stopDrag(e);
    dropSection.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.ottv.json')) {
      handlers.onOpenProjectFile(file);
    } else {
      handlers.onUploadFile(file);
    }
  });

  // Right top: Examples card
  const exSection = document.createElement('section');
  exSection.className = 'box';
  exSection.setAttribute('aria-labelledby', 'ex-title');

  const exTitle = document.createElement('h2');
  exTitle.id = 'ex-title';
  exTitle.textContent = 'Belum punya model?';

  const exSub = document.createElement('p');
  exSub.className = 'muted';
  exSub.style.margin = '6px 0 14px';
  exSub.textContent = 'Coba alurnya dengan contoh bawaan dulu.';

  const exList = document.createElement('div');
  exList.style.display = 'grid';
  exList.style.gap = '8px';

  const examples = [
    {
      id: 'contoh_kotak_m',
      icon: 'cube',
      name: 'Kotak 4 lantai',
      meta: '20 × 30 m, jendela pita, WWR 40%',
    },
    {
      id: 'fasad_curtain_wall_baru',
      icon: 'layers',
      name: 'Menara curtain wall',
      meta: 'Fasad_Curtain_Wall_Baru.3dm',
    },
  ];

  for (const ex of examples) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'example-card';

    const ic = document.createElement('span');
    ic.className = 'example-icon';
    ic.innerHTML = icon(ex.icon, 21);

    const metaWrap = document.createElement('span');
    const nameEl = document.createElement('span');
    nameEl.style.display = 'block';
    nameEl.style.fontWeight = '600';
    nameEl.textContent = ex.name;

    const subEl = document.createElement('span');
    subEl.className = 'lbl';
    subEl.textContent = ex.meta;

    metaWrap.append(nameEl, subEl);
    btn.append(ic, metaWrap);
    btn.addEventListener('click', () => handlers.onLoadExample(ex.id, ex.name));
    exList.appendChild(btn);
  }

  exSection.append(exTitle, exSub, exList);

  // Right bottom: Disclaimer card ("Tentang hasilnya")
  const discSection = document.createElement('section');
  discSection.className = 'box disclaimer-box';
  discSection.setAttribute('aria-labelledby', 'disc-title');

  const discTitle = document.createElement('h2');
  discTitle.id = 'disc-title';
  discTitle.style.fontSize = '14px';
  discTitle.textContent = 'Tentang hasilnya';

  const discBody = document.createElement('p');
  discBody.className = 'muted';
  discBody.style.margin = '6px 0 0';
  discBody.style.fontSize = '13px';
  discBody.style.lineHeight = '20px';
  discBody.textContent =
    'LUXA adalah alat bantu belajar dan simulasi berdasarkan SNI 6389:2020. Hasilnya bukan dokumen kepatuhan resmi. Model diproses di server LUXA dan tidak dibagikan.';

  const logoWrap = document.createElement('div');
  logoWrap.style.marginTop = '12px';
  logoWrap.style.display = 'flex';
  logoWrap.style.alignItems = 'center';
  logoWrap.style.gap = '8px';

  const logoImg = document.createElement('img');
  logoImg.src = state.theme === 'dark' ? '/brand/luxa-logo-dark.svg' : '/brand/luxa-logo.svg';
  logoImg.alt = 'LUXA by Alf Studio';
  logoImg.style.height = '24px';
  logoImg.style.width = 'auto';

  logoWrap.appendChild(logoImg);
  discSection.append(discTitle, discBody, logoWrap);

  main.append(dropSection, exSection, discSection);
  return main;
}
