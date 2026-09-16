import { Navigate, useSearchParams } from 'react-router-dom';

/** Ancien lien WhatsApp / favoris → ouvre la modale sur le dashboard. */
export default function Payment() {
  const [params] = useSearchParams();
  const bot = params.get('bot');
  const q = new URLSearchParams({ pay: '1' });
  if (bot) q.set('bot', bot);
  return <Navigate to={`/dashboard?${q.toString()}`} replace />;
}
