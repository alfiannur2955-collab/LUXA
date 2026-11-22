/**
 * Global keyboard shortcuts (`docs/FASE4_UI_SPEC.md` §6):
 * - 1, 2, 3, 4 : Perspektif, 2 titik, Aksonometri, Tampak
 * - hold V     : 8-direction pie menu (release to pick, Esc to cancel)
 * - F          : Fit camera to model
 * - S          : Save current view
 * - C          : Capture PNG
 * - Space      : Play sun one day (notice until 4b-2)
 * - Esc        : Close card, palette, shortcuts, popover, or pie menu
 * - Ctrl+K     : Command palette
 * - ?          : Shortcuts reference card
 *
 * Strictly ignores non-Escape / non-Ctrl+K keys whenever focus is inside an input/textarea/select.
 */

function isTextInputFocused(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function installShortcuts({ getState, pieMenu, handlers }) {
  let holdingV = false;

  const onKeyDown = (e) => {
    // Ctrl+K / Cmd+K works anywhere
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (pieMenu.isOpen) pieMenu.close({ commit: false });
      handlers.onToggleCommandPalette();
      return;
    }

    // Escape closes layers from topmost down
    if (e.key === 'Escape') {
      if (pieMenu.isOpen) {
        e.preventDefault();
        holdingV = false;
        pieMenu.close({ commit: false });
        return;
      }
      const s = getState();
      if (s.commandPaletteOpen) {
        e.preventDefault();
        handlers.onCloseCommandPalette();
        return;
      }
      if (s.shortcutsModalOpen) {
        e.preventDefault();
        handlers.onCloseShortcuts();
        return;
      }
      if (s.materialCatalog?.open) {
        e.preventDefault();
        handlers.onCloseMaterialCatalog?.();
        return;
      }
      if (s.northRotateMode) {
        e.preventDefault();
        handlers.onToggleNorthRotateMode?.(false);
        return;
      }
      if (s.openPopover) {
        e.preventDefault();
        handlers.onClosePopover();
        return;
      }
      if (s.dockCustomizerOpen || s.activeRailCard || s.workspace?.preset === 'presentasi') {
        e.preventDefault();
        handlers.onCloseRailCard();
        return;
      }
      return;
    }

    // Ignore all single-key shortcuts while typing in form controls or when palette is open
    if (isTextInputFocused(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const s = getState();
    if (s.commandPaletteOpen || s.materialCatalog?.open) return;

    // While pie menu is open, arrow keys cycle sectors
    if (pieMenu.isOpen) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        pieMenu.stepKeyboard(1);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        pieMenu.stepKeyboard(-1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        holdingV = false;
        pieMenu.close({ commit: true });
        return;
      }
    }

    if (e.key === '?') {
      e.preventDefault();
      handlers.onToggleShortcuts();
      return;
    }

    const viewerActive =
      s.step === 'confirm' || s.step === 'inspect' || s.step === 'results' || s.step === 'compare';
    if (!viewerActive) return;

    if (e.key === '1') {
      e.preventDefault();
      handlers.onSetProjection('perspective');
    } else if (e.key === '2') {
      e.preventDefault();
      handlers.onSetProjection('two_point');
    } else if (e.key === '3') {
      e.preventDefault();
      handlers.onSetProjection('axonometric');
    } else if (e.key === '4') {
      e.preventDefault();
      handlers.onSetProjection('elevation');
    } else if (e.key.toLowerCase() === 'v' && !e.repeat && !holdingV) {
      e.preventDefault();
      holdingV = true;
      const viewerEl = document.querySelector('.viewer');
      pieMenu.open({
        currentDirection: s.cameraDirection,
        anchorEl: viewerEl,
        onSelect: (code) => handlers.onSelectDirection(code),
        onSelectOrientationMode: () => handlers.onChangeViewerMode?.('orientation'),
      });
    } else if (e.key.toLowerCase() === 'r') {
      e.preventDefault();
      handlers.onToggleNorthRotateMode?.();
    } else if (e.key.toLowerCase() === 'f') {
      e.preventDefault();
      handlers.onFitCamera();
    } else if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      handlers.onSaveView();
    } else if (e.key.toLowerCase() === 'c') {
      e.preventDefault();
      handlers.onCapturePng(s.captureScale || 2);
    } else if (e.code === 'Space') {
      e.preventDefault();
      handlers.onToggleSunPlayback();
    }
  };

  const onKeyUp = (e) => {
    if (e.key.toLowerCase() === 'v' && holdingV) {
      holdingV = false;
      if (pieMenu.isOpen) {
        pieMenu.close({ commit: true });
      }
    }
  };

  const onBlur = () => {
    if (holdingV || pieMenu.isOpen) {
      holdingV = false;
      pieMenu.close({ commit: false });
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
