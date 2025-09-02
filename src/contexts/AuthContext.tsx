// src/contexts/AuthContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getJSON, postJSON } from "../lib/http";

export type Role = "SUPERADMIN" | "ADMIN" | "LEADER" | "USER";

type UserShape = {
  id: string;
  loginId: string;
  role: Role;
  clanId: string | null;
  clanName?: string | null;       // ✅ 추가
  serverDisplay?: string | null;  // ✅ 추가
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
        const rt = localStorage.getItem("refreshToken");

        // 토큰 전혀 없으면 종료
        if (!at && !rt) { setLoading(false); return; }

        // 1) refreshToken이 있으면 선제적으로 access 재발급
        if (rt) {
          try {
            const refreshed = await postJSON<{ ok: true; accessToken: string }>("/v1/auth/refresh", { refreshToken: rt });
            if (refreshed?.accessToken) {
              localStorage.setItem("accessToken", refreshed.accessToken);
            }
          } catch {
            // 리프레시 실패면 토큰 정리 후 종료
            cleanupTokens();
            setUser(null);
            setLoading(false);
            return;
          }
        }

        // 2) 최신 access로 me 호출
        const me = await getJSON<{ ok: true; user: { id: string; loginId: string; role: Role; clanId: string | null } }>("/v1/auth/me");
        setUser(me.user); // ✅ clanName/serverDisplay 같이 세팅
        setUser({ ...me.user, clanName: localStorage.getItem("clanName") ?? undefined });
      } catch {
        cleanupTokens();
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (loginId: string, password: string) => {
    const res = await postJSON<{
      ok: true;
      user: { id: string; loginId: string; role: Role; clanId: string | null };
      accessToken: string;
      refreshToken: string;
      clanName?: string | null;
    }>("/v1/auth/login", { loginId, password });

    try {
      localStorage.setItem("accessToken", res.accessToken);
      localStorage.setItem("refreshToken", res.refreshToken);
      setUser(res.user);
      if (res.clanName != null) localStorage.setItem("clanName", res.clanName);
      else localStorage.removeItem("clanName");
    } catch {}
    setUser({ ...res.user, clanName: res.clanName ?? undefined });
  };

  const logout = () => {
    cleanupTokens();
    setUser(null);
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };

  const value = useMemo(
    () => ({
      user,
      role: user?.role ?? null,
      loading,
      login,
      setUser,
      logout,
    }),
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