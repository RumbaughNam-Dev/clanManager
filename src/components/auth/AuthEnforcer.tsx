import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

type Props = { children: React.ReactNode };

/**
 * 전역 인증 가드:
 * - 로그인 안되어 있고, 공개 경로가 아니면 => /dashboard 로 리다이렉트
 * - /dashboard 는 IntroGuest가 뜨는 공개 페이지로 사용
 */
export default function AuthEnforcer({ children }: Props) {
  const { user } = useAuth(); // user가 null/undefined면 비로그인
  const location = useLocation();
  const navigate = useNavigate();

  // 필요한 공개 경로만 추가하세요.
  const PUBLIC_PATHS = new Set<string>([
    "/dashboard",     // IntroGuest가 뜨는 공개 홈
    "/login",
    "/signup",
    "/privacy",
    "/terms",
  ]);

  useEffect(() => {
    // 이미 공개 경로면 허용
    if (PUBLIC_PATHS.has(location.pathname)) return;

    // 비로그인 + 비공개 경로 => /dashboard 로 이동
    if (!user) {
      navigate("/dashboard", { replace: true, state: { from: location } });
    }
  }, [user, location.pathname, navigate]);

  return <>{children}</>;
}