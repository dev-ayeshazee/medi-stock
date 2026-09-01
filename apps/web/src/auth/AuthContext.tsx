import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { configureApi } from '../lib/api';
import type { AuthResponse, Role, User } from '../lib/types';

const STORAGE_KEY = 'medistock.auth';
const AUTH_EVENT = 'medistock:auth-changed';

interface StoredAuth {
  token: string;
  user: User;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  hasRole: (...roles: Role[]) => boolean;
  setSession: (session: AuthResponse) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStored(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

function writeStored(value: StoredAuth | null): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — provider state still holds the session in memory */
  }
  // Notify this tab's provider synchronously (the native `storage` event only
  // fires in *other* tabs).
  window.dispatchEvent(new Event(AUTH_EVENT));
}

/**
 * Configured once, at module load — before any component mounts.
 *
 * `getToken` reads localStorage on every call, so the token is never stale:
 * even the first request fired by a page that mounts immediately after login
 * sees the token that `setSession` just wrote.
 */
configureApi({
  getToken: () => readStored()?.token ?? null,
  onUnauthorized: () => writeStored(null),
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<StoredAuth | null>(() => readStored());

  const setSession = useCallback((next: AuthResponse) => {
    const stored: StoredAuth = { token: next.token, user: next.user };
    writeStored(stored);
    setSessionState(stored);
  }, []);

  const logout = useCallback(() => {
    writeStored(null);
    setSessionState(null);
  }, []);

  // Resync when auth changes here (custom event) or in another tab (`storage`).
  useEffect(() => {
    const sync = () => setSessionState(readStored());
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) sync();
    };
    window.addEventListener(AUTH_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(AUTH_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      token: session?.token ?? null,
      isAuthenticated: Boolean(session),
      hasRole: (...roles: Role[]) => (session ? roles.includes(session.user.role) : false),
      setSession,
      logout,
    }),
    [session, setSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

export function homePathForRole(role: Role): string {
  switch (role) {
    case 'PATIENT':
      return '/search';
    case 'PHARMACIST':
      return '/claim';
    case 'ADMIN':
      return '/admin/pharmacies';
    default:
      return '/search';
  }
}
