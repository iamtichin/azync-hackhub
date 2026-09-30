"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, apiErrorMessage } from "@/lib/api";
import type { User } from "@/lib/types";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  error: string | null;
  hasToken: boolean;
  sessionVersion: number;
  setToken: (token: string) => Promise<boolean>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  const validationRequest = useRef(0);

  const validate = useCallback(async (expectedToken?: string) => {
    const token =
      expectedToken ??
      window.sessionStorage.getItem("azync.access_token") ??
      "";
    const requestId = ++validationRequest.current;
    setHasToken(Boolean(token));
    if (!token) {
      setUser(null);
      setLoading(false);
      return false;
    }
    try {
      setLoading(true);
      const nextUser = await api.auth.me(token);
      if (
        requestId !== validationRequest.current ||
        window.sessionStorage.getItem("azync.access_token") !== token
      ) {
        return false;
      }
      setUser(nextUser);
      setError(null);
      return true;
    } catch (reason) {
      if (
        requestId !== validationRequest.current ||
        window.sessionStorage.getItem("azync.access_token") !== token
      ) {
        return false;
      }
      window.sessionStorage.removeItem("azync.access_token");
      setHasToken(false);
      setUser(null);
      setError(apiErrorMessage(reason));
      return false;
    } finally {
      if (requestId === validationRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void validate();
  }, [validate]);

  const setToken = useCallback(
    async (token: string) => {
      const normalized = token.trim();
      validationRequest.current += 1;
      setSessionVersion((current) => current + 1);
      setUser(null);
      setError(null);
      setLoading(true);
      if (!normalized) {
        window.sessionStorage.removeItem("azync.access_token");
        setHasToken(false);
        setLoading(false);
        return false;
      }
      window.sessionStorage.setItem("azync.access_token", normalized);
      setHasToken(true);
      return validate(normalized);
    },
    [validate],
  );

  const logout = useCallback(() => {
    const token = window.sessionStorage.getItem("azync.access_token");
    validationRequest.current += 1;
    window.sessionStorage.removeItem("azync.access_token");
    setSessionVersion((current) => current + 1);
    setHasToken(false);
    setUser(null);
    setError(null);
    setLoading(false);
    if (token) void api.auth.logout(token).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      hasToken,
      sessionVersion,
      setToken,
      logout,
    }),
    [user, loading, error, hasToken, sessionVersion, setToken, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
