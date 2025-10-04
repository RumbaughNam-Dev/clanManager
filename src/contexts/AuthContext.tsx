// src/contexts/AuthContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { postJSON } from "@/lib/http";

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
  login: (loginId: string, password: string) => Promise<{ mustChangePassword?: boolean }>;
  setUser: React.Dispatch<React.SetStateAction<UserShape | null>>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextShape>({
  user: null,
  role: null,
  loading: false,
  login: async () => ({ mustChangePassword: false }),
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
        if (!at) {
          setLoading(false);
          return;
        }

        // ✅ 백엔드 사양: POST /v1/auth/me (JwtAuth)
        try {
          const me = await postJSON<{ ok: true; user: UserShape & { clanName?: string | null; serverDisplay?: string | null } }>(
            "/v1/auth/me",
            {}
          );
          setUser({
            ...me.user,
            clanName: me.user.clanName ?? localStorage.getItem("clanName") ?? null,
          });
        } catch (err: any) {
          // ✅ 토큰 불일치나 만료 시 자동 초기화
          if (err?.status === 401) {
            localStorage.removeItem("accessToken");
            localStorage.removeItem("refreshToken");
            window.location.reload();
          }
          setUser(null);
        }
      } catch {
        cleanupTokens();
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

// src/contexts/AuthContext.tsx
const login = async (loginId: string, password: string) => {
  const res = await postJSON<{
    ok: true;
    user?: UserShape;
    accessToken?: string;
    refreshToken?: string;
    clanName?: string | null;
    serverDisplay?: string | null;
    mustChangePassword?: boolean;
  }>("/v1/auth/login", { loginId, password });

  // 🔴 강제 변경이면 여기서 바로 반환: 토큰/유저 저장 금지
  if (res.mustChangePassword) {
    return { mustChangePassword: true };
  }

  // ⬇️ 정상 로그인일 때만 저장
  try {
    if (res.accessToken) localStorage.setItem("accessToken", res.accessToken);
    if (res.refreshToken) localStorage.setItem("refreshToken", res.refreshToken);
    if (res.clanName != null) localStorage.setItem("clanName", res.clanName);
    else localStorage.removeItem("clanName");
  } catch {}

  if (res.user) {
    setUser({
      ...res.user,
      clanName: res.clanName ?? null,
      serverDisplay: res.serverDisplay ?? res.user.serverDisplay ?? null,
    });
  }
  return { mustChangePassword: false };
};

  const logout = () => {
    cleanupTokens();
    setUser(null);
    if (typeof window !== "undefined") {
      window.location.href = "/clanManager/";
    }
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