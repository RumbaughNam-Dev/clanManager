// src/types.ts
export type PageKey =
  | "dashboard"
  | "members"
  // | "bossMeta"           // ❌ 삭제
  | "timelineList"
  | "timelineDetail"
  | "treasury"
  | "login"
  | "signup"
  | "adminClanRequests"
  | "adminBossCycle"
  | "feedback";

export const PAGES: { key: PageKey; label: string }[] = [
  { key: "dashboard", label: "대시보드" },
  { key: "members", label: "혈맹원 관리" },
  // { key: "bossMeta", label: "보스 메타" }, // ❌ 제거
  { key: "timelineList", label: "보스 기록" }, // ✅ 이름만 쉽게
  { key: "timelineDetail", label: "타임라인 상세" },
  { key: "treasury", label: "혈비관리" },
  { key: "login", label: "로그인" },
  { key: "signup", label: "가입" },
  { key: "adminClanRequests", label: "혈맹 등록요청 처리" },
  { key: "adminBossCycle", label: "보스 젠 주기 관리" },
];

export type Role = "SUPERADMIN" | "ADMIN" | "LEADER" | "USER";

export type BossDto = {
  id: string;
  name: string;
  location: string;
  respawn: number;             // 분 단위
  isRandom: boolean;
  lastCutAt: string | null;    // ISO
  nextSpawnAt: string | null;  // ISO (다음 젠)
  overdue: boolean;

  // ⬇️ 서버가 제공 (클랜별 멍 누계)
  dazeCount: number;
};

export type ListBossesResp = {
  ok: true;
  serverTime: string;   // ISO
  tracked: BossDto[];
  forgotten: BossDto[];
};
