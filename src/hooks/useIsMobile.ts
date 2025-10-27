// src/hooks/useIsMobile.ts
import { useEffect, useMemo, useState } from "react";

const UA_MOBILE_REGEX = /Android|iPhone|iPad|iPod|SamsungBrowser|Mobile/i;

export function useIsMobile(breakpoint = 768) {
  const [w, setW] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerWidth : 1024
  );

  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const isUaMobile = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return UA_MOBILE_REGEX.test(navigator.userAgent);
  }, []);

  // 화면 폭 또는 UA 중 하나라도 모바일이면 true
  return isUaMobile || w < breakpoint;
}