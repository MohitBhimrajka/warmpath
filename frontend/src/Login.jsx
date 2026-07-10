import { useState } from 'react';
import { auth } from './api';

export default function Login({ onDone }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('maya.demo@warmpath.dev');
  const [password, setPassword] = useState('WarmPath!2026');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'signup') await auth.signup(email, password);
      await auth.login(email, password);
      onDone();
    } catch (err) {
      setError(
        err.status === 401
          ? 'That email and password don’t match an account.'
          : mode === 'signup'
            ? 'Could not create the account. Passwords need 8+ characters with upper, lower, a number and a symbol.'
            : err.message,
      );
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-box">
        <div className="brand">
          <span className="brand-mark">
            Warm<em>Path</em>
          </span>
        </div>

        <h1 className="auth-lede">
          Find who actually knows — and <em>how to reach them</em>.
        </h1>
        <p className="auth-sub">
          Directories list job titles. WarmPath reads the collaboration graph and brokers an introduction through people
          you already work with.
        </p>

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label className="eyebrow" htmlFor="email">
              Work email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="eyebrow" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={mode === 'signup' ? 'pw-hint' : undefined}
              aria-invalid={error ? true : undefined}
            />
            {/* The rules were only discoverable by failing. */}
            {mode === 'signup' && (
              <p id="pw-hint" className="field-hint">
                At least 8 characters, with upper and lower case, a number and a symbol.
              </p>
            )}
          </div>

          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>

        <p className="switch">
          {mode === 'login' ? 'No account yet?' : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => {
              const next = mode === 'login' ? 'signup' : 'login';
              setMode(next);
              setError('');
              // Don't leave the demo account's credentials sitting in a signup form.
              if (next === 'signup') {
                setEmail('');
                setPassword('');
              }
            }}
          >
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </p>

        <div className="demo-hint">
          demo · maya.demo@warmpath.dev — the requester
          <br />
          demo · chen.demo@warmpath.dev — the expert who consents
          <br />
          password · WarmPath!2026
        </div>
      </div>
    </div>
  );
}
