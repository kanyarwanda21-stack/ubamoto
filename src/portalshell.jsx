import { useState } from 'react';
import './portal.css';
import { signIn, signOut, useSession } from './lib/auth';

function LoginForm({ title }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { error: signInError } = await signIn(email, password);
    if (signInError) setError('Wrong email or password.');
    setBusy(false);
  }

  return (
    <form className="portal-card portal-login" onSubmit={handleSubmit}>
      <h1>{title}</h1>
      <p className="portal-note">Sign in with the account UBAmoto gave you.</p>

      <label>
        Email
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>

      {error && <p className="portal-error">{error}</p>}
      <button className="portal-btn" type="submit" disabled={busy}>
        {busy ? 'Signing in...' : 'Sign in'}
      </button>
      <a className="portal-link" href="#/">Back to the customer app</a>
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
          <p className="portal-note">{session.user.email}</p>
        </div>
        <button type="button" className="portal-btn portal-btn-light" onClick={signOut}>
          Sign out
        </button>
      </div>
      {children}
    </div>
  );
}