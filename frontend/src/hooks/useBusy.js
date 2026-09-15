import { useCallback, useState } from 'react';

// Empêche un double-clic de déclencher deux fois la même action : chaque
// bouton est identifié par une clé unique (ex: `activate-${id}`) et reste
// désactivé tant que son action est en cours.
export function useBusy() {
  const [busyKeys, setBusyKeys] = useState(() => new Set());

  const run = useCallback(async (key, fn) => {
    setBusyKeys((prev) => new Set(prev).add(key));
    try {
      await fn();
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const isBusy = useCallback((key) => busyKeys.has(key), [busyKeys]);

  return { run, isBusy };
}
