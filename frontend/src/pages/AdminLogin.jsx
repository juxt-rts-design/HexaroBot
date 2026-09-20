import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BrandMark, Icon } from '../components/Icons';
import PasswordField from '../components/PasswordField';
import GoogleAuthButton from '../components/GoogleAuthButton';
import { authErrorMessage, withLoginGuard } from '../utils/authGuard';

export default function AdminLogin() {
  const { user, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice] = useState(location.state?.notice || '');
  const [busy, setBusy] = useState(false);

  if (user?.role === 'admin') return <Navigate to="/admin" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const profile = await withLoginGuard(email, 'admin', () => login(email.trim(), password));
      if (!profile || profile.role !== 'admin') {
        setError('Accès réservé aux administrateurs.');
      }
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-brand">
        <BrandMark size={52} />
        <h1>HEXARO</h1>
      </div>
      <p className="muted">Espace administrateur</p>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </label>
        <PasswordField
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          id="admin-password"
        />
        <button className="btn" type="submit" disabled={busy}>
          <Icon name="admin" size={16} />
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      {notice && <p className="muted">{notice}</p>}
      {error && <p className="error-text">{error}</p>}
      <div className="auth-divider"><span>ou</span></div>
      <GoogleAuthButton next="/admin" />
    </div>
  );
}
