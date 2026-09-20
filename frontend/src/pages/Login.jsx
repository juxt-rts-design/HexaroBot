import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BrandMark } from '../components/Icons';
import PasswordField from '../components/PasswordField';
import GoogleAuthButton from '../components/GoogleAuthButton';
import { authErrorMessage, withLoginGuard } from '../utils/authGuard';

export default function Login() {
  const { user, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice] = useState(location.state?.notice || '');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await withLoginGuard(email, 'user', () => login(email.trim(), password));
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
      <p className="muted">Connectez-vous pour gérer vos chatbots WhatsApp.</p>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <PasswordField
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
      </form>
      {notice && <p className="muted">{notice}</p>}
      {error && <p className="error-text">{error}</p>}
      <p className="muted">
        Pas de compte ? <Link to="/register">Créer un compte</Link>
      </p>
      <div className="auth-divider"><span>ou</span></div>
      <GoogleAuthButton next="/dashboard" />
    </div>
  );
}
