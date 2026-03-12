import { useState, useEffect, useCallback } from 'react';
import type { User } from 'firebase/auth';
import {
  onAuthChange,
  signInGoogle,
  signInEmail,
  signUpEmail,
  logOut,
  mergeAndSync,
} from '../firebase.js';

export interface UseAuthResult {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  syncError: string | null;
}

export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);

  const syncOnLogin = useCallback(async (u: User) => {
    try {
      setSyncError(null);
      await mergeAndSync(u.uid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSyncError(message);
      console.warn('Sync on login failed:', err);
    }
  }, []);

  useEffect(() => {
    let firstFire = true;
    const unsubscribe = onAuthChange((u) => {
      setUser(u);
      setLoading(false);
      if (u && firstFire) {
        syncOnLogin(u);
      }
      firstFire = false;
    });
    return unsubscribe;
  }, [syncOnLogin]);

  const handleSignInWithGoogle = useCallback(async () => {
    const u = await signInGoogle();
    await syncOnLogin(u);
  }, [syncOnLogin]);

  const handleSignInWithEmail = useCallback(
    async (email: string, password: string) => {
      const u = await signInEmail(email, password);
      await syncOnLogin(u);
    },
    [syncOnLogin],
  );

  const handleSignUpWithEmail = useCallback(
    async (email: string, password: string) => {
      const u = await signUpEmail(email, password);
      await syncOnLogin(u);
    },
    [syncOnLogin],
  );

  const handleSignOut = useCallback(async () => {
    await logOut();
    setSyncError(null);
  }, []);

  return {
    user,
    loading,
    signInWithGoogle: handleSignInWithGoogle,
    signInWithEmail: handleSignInWithEmail,
    signUpWithEmail: handleSignUpWithEmail,
    signOut: handleSignOut,
    syncError,
  };
}
