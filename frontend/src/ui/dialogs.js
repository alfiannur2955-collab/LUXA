/**
 * Reusable accessible confirmation dialogs for D4 (`docs/RENCANA.md` Fase 4d D4):
 * - `showConfirmDeleteProjectDialog`: naming the project explicitly before deleting from browser storage.
 * - `showReplaceMaterialDialog`: "Dipakai di N grup. Ganti dengan ..." + Cancel when deleting an in-use material.
 */

function mountDialogBackdrop(dialogEl, onClose) {
  const backdrop = document.createElement('div');
  backdrop.className = 'cmd-backdrop';
  backdrop.style.zIndex = '95';

  const close = () => {
    window.removeEventListener('keydown', onKey);
    backdrop.remove();
    onClose?.();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  window.addEventListener('keydown', onKey, true);
  backdrop.appendChild(dialogEl);
  document.body.appendChild(backdrop);
  return close;
}

export function showConfirmDeleteProjectDialog(projectName, onConfirm) {
  const dialog = document.createElement('div');
  dialog.className = 'glass dock-modal';
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'del-proj-title');

  const h2 = document.createElement('h2');
  h2.id = 'del-proj-title';
  h2.style.margin = '0 0 8px';
  h2.style.fontSize = '16px';
  h2.textContent = 'Hapus proyek tersimpan?';

  const p = document.createElement('p');
  p.className = 'muted';
  p.style.margin = '0 0 16px';
  p.style.fontSize = '13px';
  p.textContent = `Proyek "${projectName}" akan dihapus dari penyimpanan browser. Tindakan ini tidak dapat diurungkan.`;

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '8px';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'ghost ghost-sm';
  cancelBtn.textContent = 'Batal';

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'cta';
  delBtn.style.height = '36px';
  delBtn.style.padding = '0 14px';
  delBtn.style.fontSize = '13px';
  delBtn.style.background = 'var(--fail)';
  delBtn.textContent = `Hapus "${projectName}"`;

  actions.append(cancelBtn, delBtn);
  dialog.append(h2, p, actions);

  const close = mountDialogBackdrop(dialog);
  cancelBtn.addEventListener('click', close);
  delBtn.addEventListener('click', () => {
    close();
    onConfirm?.();
  });
  window.requestAnimationFrame(() => cancelBtn.focus());
}

export function showReplaceMaterialDialog({ materialName, usageCount, replacementOptions = [], onReplace }) {
  const dialog = document.createElement('div');
  dialog.className = 'glass dock-modal';
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'rep-mat-title');

  const h2 = document.createElement('h2');
  h2.id = 'rep-mat-title';
  h2.style.margin = '0 0 8px';
  h2.style.fontSize = '16px';
  h2.textContent = `Hapus "${materialName}"?`;

  const p = document.createElement('p');
  p.className = 'muted';
  p.style.margin = '0 0 12px';
  p.style.fontSize = '13px';
  p.textContent = `Dipakai di ${usageCount} grup/pengaturan. Pilih material pengganti sebelum menghapus:`;

  const sel = document.createElement('select');
  sel.className = 'field-select';
  sel.setAttribute('aria-label', 'Material pengganti');
  for (const opt of replacementOptions) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.name;
    sel.appendChild(o);
  }

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '8px';
  actions.style.marginTop = '14px';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'ghost ghost-sm';
  cancelBtn.textContent = 'Batal';

  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'cta';
  okBtn.style.height = '36px';
  okBtn.style.padding = '0 14px';
  okBtn.style.fontSize = '13px';
  okBtn.textContent = 'Ganti & hapus';

  actions.append(cancelBtn, okBtn);
  dialog.append(h2, p, sel, actions);

  const close = mountDialogBackdrop(dialog);
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', () => {
    const replacementId = sel.value;
    close();
    onReplace?.(replacementId);
  });
  window.requestAnimationFrame(() => sel.focus());
}
