// src/contexts/AuthContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getJSON, postJSON } from "../lib/http";

export type Role = "SUPERADMIN" | "ADMIN" | "LEADER" | "USER";

type UserShape = {
  id: string;
  loginId: string;
  role: Role;
  clanId: string | null;
  clanName?: string | null;
  serverDisplay?: string | null;
};

type AuthContextShape = {
  user: UserShape | null;
  role: Role | null;
  loading: boolean;
  login: (loginId: string, password: string) => Promise<void>;
  setUser: React.Dispatch<React.SetStateAction<UserShape | null>>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextShape>({
  user: null,
  role: null,
  loading: false,
  login: async () => {},
  setUser: () => {},
  logout: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserShape | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const at = localStorage.getItem("accessToken");
        if (!at) { setLoading(false); return; }

        // ✅ 백엔드 사양: POST /v1/auth/me (JwtAuth)
        const me = await postJSON<{ ok: true; user: UserShape & { clanName?: string | null; serverDisplay?: string | null } }>(
          "/v1/auth/me",
          {} // 바디 없음
        );
        setUser({
          ...me.user,
          clanName: me.user.clanName ?? localStorage.getItem("clanName") ?? null,
        });
      } catch {
        cleanupTokens();
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (loginId: string, password: string) => {
    // 백엔드: POST /v1/auth/login -> { ok, user, accessToken, refreshToken?(옵션), clanName? }
    const res = await postJSON<{
      ok: true;
      user: UserShape;
      accessToken: string;
      refreshToken?: string;
      clanName?: string | null;
      serverDisplay?: string | null;
    }>("/v1/auth/login", { loginId, password });

    try {
      localStorage.setItem("accessToken", res.accessToken);
      if (res.refreshToken) localStorage.setItem("refreshToken", res.refreshToken);
      if (res.clanName != null) localStorage.setItem("clanName", res.clanName);
      else localStorage.removeItem("clanName");
    } catch {}

    setUser({
      ...res.user,
      clanName: res.clanName ?? null,
      serverDisplay: res.serverDisplay ?? res.user.serverDisplay ?? null,
    });
  };

  const logout = () => {
    cleanupTokens();
    setUser(null);
    if (typeof window !== "undefined") window.location.href = "/";
  };

  const value = useMemo(
    () => ({ user, role: user?.role ?? null, loading, login, setUser, logout }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

function cleanupTokens() {
  try {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("clanName");
  } catch {}
}

export const useAuth = () => useContext(AuthContext);