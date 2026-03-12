import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth.js';

export function AuthButton() {
  const { user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (loading) return null;

  if (user) {
    return (
      <div className="auth-wrapper" ref={dropdownRef}>
        <button
          className="auth-btn auth-btn-user"
          onClick={() => setOpen(!open)}
          title={user.email ?? user.displayName ?? 'Account'}
        >
          {user.photoURL ? (
            <img src={user.photoURL} alt="" className="auth-avatar" referrerPolicy="no-referrer" />
          ) : (
            <span className="auth-avatar-placeholder">
              {(user.email ?? user.displayName ?? '?')[0].toUpperCase()}
            </span>
          )}
        </button>
        {open && (
          <div className="auth-dropdown">
            <div className="auth-dropdown-user">{user.email ?? user.displayName}</div>
            <button
              className="auth-dropdown-item"
              onClick={async () => {
                await signOut();
                setOpen(false);
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="auth-wrapper" ref={dropdownRef}>
      <button className="auth-btn" onClick={() => setOpen(!open)}>
        Sign in
      </button>
      {open && (
        <div className="auth-dropdown">
          <button
            className="auth-dropdown-google"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await signInWithGoogle();
                setOpen(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Continue with Google
          </button>
          <div className="auth-divider">or</div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                if (isSignUp) {
                  await signUpWithEmail(email, password);
                } else {
                  await signInWithEmail(email, password);
                }
                setOpen(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <input
              className="auth-input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="auth-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
            <button className="auth-submit" type="submit" disabled={busy}>
              {isSignUp ? 'Sign up' : 'Sign in'}
            </button>
          </form>
          <button className="auth-toggle" onClick={() => setIsSignUp(!isSignUp)}>
            {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
          {error && <div className="auth-error">{error}</div>}
        </div>
      )}
    </div>
  );
}
