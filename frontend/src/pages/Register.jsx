import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BrandMark } from '../components/Icons';
import PasswordField from '../components/PasswordField';
import GoogleAuthButton from '../components/GoogleAuthButton';
import { authErrorMessage } from '../utils/authGuard';

export default function Register() {
  const { user, register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      const profile = await register(email.trim(), password, name.trim());
      if (!profile) {
        setInfo('Compte créé. Vérifie ton email si la confirmation est activée, puis connecte-toi.');
      }
    } catch (err) {
      setError(authErrorMessage(err) || 'Inscription impossible.');
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
      <p className="muted">Créer un compte — ou utilise Google.</p>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Nom
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <PasswordField
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          id="register-password"
        />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Création…' : "S'inscrire"}</button>
      </form>
      {error && <p className="error-text">{error}</p>}
      {info && <p style={{ color: 'var(--accent-bright)' }}>{info}</p>}
      <p className="muted">
        Déjà un compte ? <Link to="/login">Se connecter</Link>
      </p>
      <div className="auth-divider"><span>ou</span></div>
      <GoogleAuthButton next="/dashboard" />
    </div>
  );
}
