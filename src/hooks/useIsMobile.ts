import { useEffect, useState } from "react";

export function useIsMobile(breakpointPx = 768) {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpointPx : false
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width:${breakpointPx - 1}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange(); // 초기 동기화
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [breakpointPx]);

  return isMobile;
}