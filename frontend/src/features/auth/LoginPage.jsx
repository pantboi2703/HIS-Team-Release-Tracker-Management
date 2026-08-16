import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useLoginMutation } from '../../api/rttApi.js';
import { setAccessToken, USE_MOCK } from '../../api/client.js';
import { signedIn } from '../../app/sessionSlice.js';

const MAX_TRIES = 5;

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tries, setTries] = useState(0);
  const [error, setError] = useState(null);
  const [login, { isLoading }] = useLoginMutation();
  const dispatch = useDispatch();

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await login({ username: username.trim(), password }).unwrap();
      setAccessToken(res.access_token);
      dispatch(signedIn({ user: res.user }));
    } catch (err) {
      setTries((t) => t + 1);
      setError(err?.data?.detail || 'Could not sign you in');
    }
  };

  const locked = tries >= MAX_TRIES;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 22,
      }}
    >
      <form className="card" style={{ padding: 22, width: 364 }} onSubmit={submit}>
        <div className="h1">Release testing tracker</div>
        <div className="soft" style={{ fontSize: 'var(--fs-12)', marginTop: 3 }}>
          Release testing records for the HIS IT department, Amrita Hospital Faridabad.
        </div>

        {error && (
          <div className="banner banner-danger" style={{ marginTop: 14 }}>
            <div style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>{error}</div>
            <div style={{ marginTop: 2 }}>
              Check the username spelling first, then try again. After{' '}
              <span className="mono">{MAX_TRIES}</span> wrong tries the account locks for{' '}
              <span className="mono">10</span> minutes — ask Mayank Pant to reset it if you are unsure.
            </div>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <div className="soft" style={{ fontSize: 'var(--fs-12)', marginBottom: 5 }}>
            Username
          </div>
          <input
            className="input"
            value={username}
            autoFocus
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
            placeholder="bharti.sehgal"
          />
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="soft" style={{ fontSize: 'var(--fs-12)', marginBottom: 5 }}>
            Password
          </div>
          <input
            className="input"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            style={error ? { borderColor: 'var(--danger)' } : undefined}
          />
          {tries > 0 && (
            <div className="mono" style={{ fontSize: 'var(--fs-11)', color: 'var(--danger)', marginTop: 5 }}>
              {tries} of {MAX_TRIES} tries used
            </div>
          )}
        </div>

        <button
          className="btn btn-primary"
          type="submit"
          disabled={isLoading || locked || !username || !password}
          style={{ marginTop: 14, width: '100%' }}
        >
          {locked ? 'Locked — ask an admin' : isLoading ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="muted" style={{ fontSize: 'var(--fs-12)', marginTop: 12 }}>
          A later version will sign you in with your hospital network credentials. Until then, ask an
          admin for a username.
        </div>

        {USE_MOCK && (
          <div className="banner banner-info" style={{ marginTop: 12 }}>
            Demo build. Any seeded username works with the password{' '}
            <span className="mono bold">amrita</span> — try{' '}
            <button
              type="button"
              className="nav-link"
              style={{ color: 'var(--ink)', textDecoration: 'underline' }}
              onClick={() => {
                setUsername('ranga.n');
                setPassword('amrita');
              }}
            >
              ranga.n
            </button>{' '}
            (admin),{' '}
            <button
              type="button"
              className="nav-link"
              style={{ color: 'var(--ink)', textDecoration: 'underline' }}
              onClick={() => {
                setUsername('bharti.sehgal');
                setPassword('amrita');
              }}
            >
              bharti.sehgal
            </button>{' '}
            (tester) or{' '}
            <button
              type="button"
              className="nav-link"
              style={{ color: 'var(--ink)', textDecoration: 'underline' }}
              onClick={() => {
                setUsername('mayank.pant');
                setPassword('amrita');
              }}
            >
              mayank.pant
            </button>{' '}
            (coordinator).
          </div>
        )}
      </form>
    </div>
  );
}
