import { useEffect } from 'react';

/**
 * Frein soft contre F12 / clic droit / raccourcis inspecteur.
 * Contournable (navigateur = côté client) — ne remplace pas la sécurité serveur.
 */
export function useInspectGuard(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;

    function onContextMenu(e) {
      e.preventDefault();
    }

    function onKeyDown(e) {
      const key = e.key;
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      if (key === 'F12') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (ctrl && shift && ['I', 'J', 'C', 'K'].includes(key.toUpperCase())) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (ctrl && key.toUpperCase() === 'U') {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [enabled]);
}
