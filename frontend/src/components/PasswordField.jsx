import { useState } from 'react';
import { Icon } from './Icons';

/** Champ mot de passe avec œil afficher / masquer. */
export default function PasswordField({
  value,
  onChange,
  label = 'Mot de passe',
  required = true,
  autoComplete = 'current-password',
  minLength,
  id,
}) {
  const [visible, setVisible] = useState(false);
  const inputId = id || 'password-field';

  return (
    <label className="password-field" htmlFor={inputId}>
      {label}
      <div className="password-field-wrap">
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          required={required}
          autoComplete={autoComplete}
          minLength={minLength}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          title={visible ? 'Masquer' : 'Afficher'}
          tabIndex={0}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} size={18} />
        </button>
      </div>
    </label>
  );
}
