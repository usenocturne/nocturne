import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { get, post } from "../api";

interface AuthState {
  authenticated: boolean;
  user: { id: string; email?: string } | null;
  loading: boolean;
  isInitializing: boolean;
  passwordResetPending: boolean;
  setupComplete: boolean;
}

interface AuthContextValue extends AuthState {
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  authenticated: false,
  user: null,
  loading: true,
  isInitializing: false,
  passwordResetPending: false,
  setupComplete: false,
  refresh: async () => {},
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function useAuthProvider(): AuthContextValue {
  const [state, setState] = useState<AuthState>({
    authenticated: false,
    user: null,
    loading: true,
    isInitializing: false,
    passwordResetPending: false,
    setupComplete: false,
  });

  const refresh = useCallback(async () => {
    try {
      const status = await get("/api/auth/status");
      setState({
        authenticated: status.authenticated,
        user: status.user,
        loading: false,
        isInitializing: !!status.isInitializing,
        passwordResetPending: !!status.passwordResetPending,
        setupComplete: !!status.setupComplete,
      });
    } catch {
      setState({
        authenticated: false,
        user: null,
        loading: false,
        isInitializing: false,
        passwordResetPending: false,
        setupComplete: false,
      });
    }
  }, []);

  const signOut = useCallback(async () => {
    await post("/api/auth/signout");
    setState((prev) => ({
      authenticated: false,
      user: null,
      loading: false,
      isInitializing: false,
      passwordResetPending: false,
      setupComplete: prev.setupComplete,
    }));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!state.isInitializing) return;
    const id = setInterval(() => {
      refresh();
    }, 2000);
    return () => clearInterval(id);
  }, [state.isInitializing, refresh]);

  return { ...state, refresh, signOut };
}
