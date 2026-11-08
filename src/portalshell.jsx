import { useState } from 'react';
import './portal.css';
import { signIn, signOut, useSession } from './lib/auth';

function LoginForm({ title }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { error: signInError } = await signIn(phone, pin);
    if (signInError) setError(signInError.message || 'Wrong phone number or PIN.');
    setBusy(false);
  }

  return (
    <form className="portal-card portal-login" onSubmit={handleSubmit}>
      <h1>{title}</h1>
      <p className="portal-note">Sign in with the account UBAmoto gave you.</p>

      <label>
        Phone number
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          required
        />
      </label>
      <label>
        PIN
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]{4,6}"
          maxLength={6}
          autoComplete="current-password"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
          required
        />
      </label>

      {error && <p className="portal-error">{error}</p>}
      <button className="portal-btn" type="submit" disabled={busy}>
        {busy ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}

// Shows the sign-in form until someone is signed in, then the portal itself.
export default function PortalShell({ title, children }) {
  const session = useSession();

  if (session === undefined) {
    return <div className="portal"><p className="portal-note">Loading...</p></div>;
  }

  if (!session) {
    return (
      <div className="portal">
        <LoginForm title={title} />
      </div>
    );
  }

  return (
    <div className="portal">
      <div className="portal-head">
        <div>
          <h1>{title}</h1>
        </div>
        <button type="button" className="portal-btn portal-btn-light" onClick={signOut}>
          Sign out
        </button>
      </div>
      {children}
    </div>
  );
}