import { useCallback, useEffect, useState } from 'react';

/**
 * Notifications navigateur (connexion / déconnexion bots) + permission.
 */
export function useDesktopNotify() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );

  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    setPermission(Notification.permission);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return 'denied';
    if (Notification.permission === 'granted') {
      setPermission('granted');
      return 'granted';
    }
    if (Notification.permission !== 'denied') {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    }
    return Notification.permission;
  }, []);

  const notify = useCallback(async ({ title, body, tag }) => {
    if (typeof Notification === 'undefined') return;
    let perm = Notification.permission;
    if (perm === 'default') {
      perm = await Notification.requestPermission();
      setPermission(perm);
    }
    if (perm !== 'granted') return;
    try {
      const n = new Notification(title || 'HEXARO', {
        body,
        tag: tag || 'hexaro-status',
        icon: '/logo-hexaro.png',
        badge: '/logo-hexaro.png',
      });
      setTimeout(() => n.close(), 6000);
    } catch {
      /* ignore */
    }
  }, []);

  return { permission, requestPermission, notify };
}
