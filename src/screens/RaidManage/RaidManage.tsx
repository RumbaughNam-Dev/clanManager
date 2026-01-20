// src/raid/RaidManage.tsx
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { postJSON } from "@/lib/http";
import { useAuth } from "@/contexts/AuthContext";

/** 날짜 유틸 */
const MS_DAY = 24 * 60 * 60 * 1000;

function getMonday(d: Date) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addWeeks(d: Date, w: number) {
  return new Date(d.getTime() + w * 7 * MS_DAY);
}

function getWeekInfoBySunday(monday: Date) {
  // 이 주의 일요일 = 월요일 + 6일
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  const year = sunday.getFullYear();
  const monthIndex = sunday.getMonth(); // 0~11

  // 해당 달의 첫 번째 일요일 찾기
  const firstDayOfMonth = new Date(year, monthIndex, 1); // 그 달 1일
  const firstDayWeekday = firstDayOfMonth.getDay(); // 0=일, 1=월, ...
  const offsetToSunday = (7 - firstDayWeekday) % 7; // 첫 일요일까지 +몇일
  const firstSunday = new Date(year, monthIndex, 1 + offsetToSunday);

  const diffDays = Math.floor(
    (sunday.getTime() - firstSunday.getTime()) / MS_DAY
  );
  const week = Math.floor(diffDays / 7) + 1;

  return {
    year,
    month: monthIndex + 1, // 1~12
    week,
  };
}

function formatWeekRange(monday: Date): string {
  const start = monday;
  const end = new Date(monday.getTime() + 6 * MS_DAY); // 월요일 ~ 일요일

  const sm = start.getMonth() + 1;
  const sd = start.getDate();
  const em = end.getMonth() + 1;
  const ed = end.getDate();

  return `${sm}월 ${sd}일 ~ ${em}월 ${ed}일`;
}

/** 타입 정의 */
type WeekItem = {
  index: number;
  monday: Date;
  year: number;
  month: number;
  week: number;
  weekKey: string; // year-month-week
};

type BossMeta = {
  bossMetaId: number;
  bossName: string;
  raidLevel: number;
};

type RaidResult = {
  bossMetaId: number;
};

type WeekStatus = "none" | "partial" | "all"; // 미완료 / 일부완료 / 완료

type Member = {
  id: number;
  loginId: string;
  nickname: string | null;
};

type DraftRow = {
  id: number;
  itemName: string;
  looterInput: string;
  looterId: number | null;
};

type DropItem = {
  id: number;
  itemName: string;
  looterId: number;
  looterName: string;
  salePrice: number | null;
  isSold: boolean;
  isTreasury: boolean;
  isDistributed: boolean;
};

type DistributionMode = "ITEM" | "TREASURY";

type RaidItemServer = {
  id: string;
  itemName: string;
  rootUserId: number;
  isSold: boolean;
  soldPrice: number | null;
  isTreasury: boolean;
  isDistributed: boolean;
  distributionMode?: DistributionMode;
};

/** 한글 초성 검색 유틸 */
const HANGUL_BASE = 0xac00;
const CHOSEONG_LIST = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];

function getInitials(str: string): string {
  let result = "";
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= HANGUL_BASE && code <= 0xd7a3) {
      const idx = Math.floor((code - HANGUL_BASE) / (21 * 28));
      result += CHOSEONG_LIST[idx] ?? ch;
    } else {
      result += ch;
    }
  }
  return result;
}

/** 한글 초성 + 일반 포함 검색 */
function koreanMatch(source: string, query: string): boolean {
  const q = query.trim();
  if (!q) return false;

  const srcLower = source.toLowerCase();
  const qLower = q.toLowerCase();

  // 1) 일반 포함 검색
  if (srcLower.includes(qLower)) return true;

  // 2) 초성 기반 검색
  const initials = getInitials(source);
  if (initials.includes(q)) return true;

  return false;
}

function isClanAdmin(user: any | null): boolean {
  if (!user) return false;
  return (
    user.role === "ADMIN" ||
    user.role === "LEADER" ||
    user.role === "SUPERADMIN"
  );
}

function createInitialDraftRows(): DraftRow[] {
  const rows: DraftRow[] = [];
  for (let i = 0; i < 5; i++) {
    rows.push({
      id: i + 1,
      itemName: "",
      looterInput: "",
      looterId: null,
    });
  }
  return rows;
}

const MAX_DRAFT_ROWS = 10;

export default function RaidManage() {
  const baseMonday = useMemo(() => getMonday(new Date()), []);
  const saveLockRef = useRef(Promise.resolve());

  const [weekIndices, setWeekIndices] = useState<number[]>(() => {
    const arr: number[] = [];
    for (let i = -8; i < 8; i++) arr.push(i);
    return arr;
  });

  function getBossColor(level: number): string {
    if (level <= 2) return "text-green-600"; // 초록
    if (level === 3) return "text-blue-500"; // 파랑
    if (level === 4) return "text-red-600"; // 빨강
    if (level === 5) return "text-purple-500"; // 보라
    return "text-yellow-500"; // 6~10 노랑
  }

  /** 스크롤 컨트롤 */
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const topWheelRef = useRef(0);
  const bottomWheelRef = useRef(0);

  /** 주차리스트 생성 */
  const weekItems = useMemo<WeekItem[]>(() => {
    return weekIndices.map((idx) => {
      const monday = addWeeks(baseMonday, idx);

      // 일요일 기준 연/월/주차 계산
      const info = getWeekInfoBySunday(monday);
      const y = info.year;
      const m = info.month;
      const w = info.week;

      const weekKey = `${y}-${String(m).padStart(2, "0")}-${String(w).padStart(
        2,
        "0"
      )}`;

      return {
        index: idx,
        monday,
        year: y,
        month: m,
        week: w,
        weekKey,
      };
    });
  }, [weekIndices, baseMonday]);

  /** 현재 주차 */
  const todayMonday = getMonday(new Date());
  const currentInfo = getWeekInfoBySunday(todayMonday);
  const currentYear = currentInfo.year;
  const currentMonth = currentInfo.month;
  const currentWeek = currentInfo.week;

  /** 선택된 주차 */
  const [selectedWeek, setSelectedWeek] = useState<WeekItem | null>(null);

  /** 주차별 완료 상태 맵: key = year-month-week */
  const [weekStatusMap, setWeekStatusMap] = useState<
    Record<string, WeekStatus>
  >({});

  const [cutTimeMap, setCutTimeMap] = useState<Record<number, string>>({});

  /** 팝업용: 어떤 보스에 대해 정보입력 중인지 */
  const [activeBossForPopup, setActiveBossForPopup] = useState<BossMeta | null>(
    null
  );

  /** 팝업 내부 상태들 */
  const [distributionMode, setDistributionMode] =
    useState<DistributionMode>("ITEM"); // ← 분배 방식(읽기 전용처럼 사용)
  // 분배 방식 선택 오버레이 on/off
  const [modeSelectorOpen, setModeSelectorOpen] = useState(false);
  // 오버레이 안에서 선택 중인 값
  const [pendingDistributionMode, setPendingDistributionMode] =
  useState<DistributionMode>("ITEM");
  const [draftRows, setDraftRows] = useState<DraftRow[]>(() =>
    createInitialDraftRows()
  );
  const draftRowIdRef = useRef<number>(6);
  const [savedItems, setSavedItems] = useState<DropItem[]>([]);
  const [looterActiveIndexMap, setLooterActiveIndexMap] = useState<
    Record<number, number>
  >({});
  const [members, setMembers] = useState<Member[]>([]);
  const [mode, setMode] = useState<"input" | "list" | "edit">("input");

  /** 서버 데이터 */
  const [bossMetas, setBossMetas] = useState<BossMeta[]>([]);
  const [raidResults, setRaidResults] = useState<RaidResult[]>([]);

  /** 로그인 유저 */
  const { user } = useAuth();
  const clanId = user?.clanId ? Number(user.clanId) : 1;

  const [cutModeSelectorOpen, setCutModeSelectorOpen] = useState(false);
  const [pendingCutBossId, setPendingCutBossId] = useState<number | null>(null);
  const [selectedCutMode, setSelectedCutMode] =
    useState<DistributionMode>("ITEM");

  /** 보스별 분배 방식 캐시(현재 화면에서만 유지) */
  const [bossDistributionMap, setBossDistributionMap] = useState<
    Record<number, DistributionMode>
  >({});

  /** 처음 로드시 현재 주 자동 선택 */
  useEffect(() => {
    if (selectedWeek) return;

    const found = weekItems.find(
      (w) =>
        w.year === currentYear &&
        w.month === currentMonth &&
        w.week === currentWeek
    );

    if (found) {
      setSelectedWeek(found);

      setTimeout(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const idx = weekItems.findIndex((w) => w.index === found.index);
        if (idx >= 0) {
          const rowHeight = 48;
          el.scrollTop = idx * rowHeight - el.clientHeight / 2 + rowHeight;
        }
      }, 0);
    }
  }, [weekItems, selectedWeek, currentYear, currentMonth, currentWeek]);

  /** 이전/다음 주차 추가 */
  const prependWeeks = () => {
    setWeekIndices((prev) => {
      const min = prev[0];
      const arr: number[] = [];
      for (let i = min - 8; i < min; i++) arr.push(i);

      const el = scrollContainerRef.current;
      if (el) {
        const rowHeight = 48;
        el.scrollTop = el.scrollTop + rowHeight * 8;
      }

      return [...arr, ...prev];
    });
  };

  const appendWeeks = () => {
    setWeekIndices((prev) => {
      const max = prev[prev.length - 1];
      const arr: number[] = [];
      for (let i = max + 1; i <= max + 8; i++) arr.push(i);
      return [...prev, ...arr];
    });
  };

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;

    if (scrollTop > 0) topWheelRef.current = 0;
    if (scrollTop + clientHeight < scrollHeight - 1)
      bottomWheelRef.current = 0;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    const atTop = scrollTop <= 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

    if (atTop && e.deltaY < 0) {
      topWheelRef.current++;
      if (topWheelRef.current >= 3) {
        prependWeeks();
        topWheelRef.current = 0;
      }
    }

    if (atBottom && e.deltaY > 0) {
      bottomWheelRef.current++;
      if (bottomWheelRef.current >= 3) {
        appendWeeks();
        bottomWheelRef.current = 0;
      }
    }
  };

  /** 보스 메타 조회 (한 번만) */
  useEffect(() => {
    (async () => {
      const res = await postJSON<{ bossMetas: BossMeta[] }>(
        "/v1/pledge-raid/boss-metas"
      );
      setBossMetas(res.bossMetas);
    })();
  }, []);

  /** 혈맹원 목록 (루팅자 자동완성용) */
  useEffect(() => {
    (async () => {
      try {
        const url =
          clanId != null
            ? `/v1/members/list?clanId=${encodeURIComponent(String(clanId))}`
            : `/v1/members/list`;

        const res = await postJSON<{ ok: boolean; members: Member[] }>(url);
        setMembers(res.members ?? []);
      } catch (e) {
        console.warn("members fetch failed", e);
      }
    })();
  }, [clanId]);

  /** 좌측 주차 리스트용: 화면에 보이는 모든 주차의 상태를 미리 계산 */
  useEffect(() => {
    // 보스 메타 정보를 아직 못 가져왔으면 계산 불가
    if (bossMetas.length === 0) return;
    if (weekItems.length === 0) return;

    let cancelled = false;

    (async () => {
      const totalBosses = bossMetas.length;
      const nextMap: Record<string, WeekStatus> = {};

      await Promise.all(
        weekItems.map(async (w) => {
          try {
            const res = await postJSON<{ results: RaidResult[] }>(
              `/v1/pledge-raid/results?year=${w.year}&month=${w.month}&week=${w.week}&clanId=${clanId}`
            );
            const results = res.results ?? [];

            let status: WeekStatus = "none";
            if (results.length === 0) {
              status = "none";
            } else if (totalBosses > 0 && results.length >= totalBosses) {
              status = "all";
            } else {
              status = "partial";
            }

            nextMap[w.weekKey] = status;
          } catch (e) {
            // 해당 주차 조회 실패하면 미진행으로 둔다
            nextMap[w.weekKey] = "none";
          }
        })
      );

      if (!cancelled) {
        // 기존 값(이미 계산된 주차)이 있으면 유지하면서 덮어쓰기
        setWeekStatusMap((prev) => ({
          ...prev,
          ...nextMap,
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [weekItems, bossMetas.length, clanId]);

  /** 선택된 주의 컷 정보 조회 + 주차 상태 계산 */
  useEffect(() => {
    if (!selectedWeek) return;

    (async () => {
      const res = await postJSON<{ results: RaidResult[] }>(
        `/v1/pledge-raid/results?year=${selectedWeek.year}&month=${selectedWeek.month}&week=${selectedWeek.week}&clanId=${clanId}`
      );
      const results = res.results ?? [];
      setRaidResults(results);

      // 완료 상태 계산
      const totalBosses = bossMetas.length;
      let status: WeekStatus = "none";
      if (results.length === 0) {
        status = "none";
      } else if (totalBosses > 0 && results.length >= totalBosses) {
        status = "all";
      } else {
        status = "partial";
      }

      const key = selectedWeek.weekKey;
      setWeekStatusMap((prev) => ({ ...prev, [key]: status }));
    })();
  }, [selectedWeek, clanId, bossMetas.length]);

    useEffect(() => {
    if (!activeBossForPopup || !selectedWeek) return;

    (async () => {
      try {
        const res = await postJSON<{ ok: boolean; isTreasury: boolean; items: RaidItemServer[] }>(
          "/v1/pledge-raid/items/list",
          {
            year: selectedWeek.year,
            month: selectedWeek.month,
            week: selectedWeek.week,
            clanId,
            bossMetaId: activeBossForPopup.bossMetaId,
          }
        );

        // ✅ 보스 결과 기준으로만 모드 결정
        setDistributionMode(res.isTreasury ? "TREASURY" : "ITEM");

        const items = res.items ?? [];

        if (items.length === 0) {
          setSavedItems([]);
          setDraftRows(createInitialDraftRows());
          setLooterActiveIndexMap({});
          draftRowIdRef.current = 6;
          setMode("input");
          return;
        }

        const mapped: DropItem[] = items.map((it, idx) => {
          const mem = members.find((m) => m.id === it.rootUserId);
          const looterName = mem?.nickname || mem?.loginId || String(it.rootUserId);
          return {
            id: Number(it.id),    // ✅ 서버 id 그대로 사용
            itemName: it.itemName,
            looterId: Number(it.rootUserId),
            looterName,
            salePrice: it.soldPrice ?? null,
            isSold: it.isSold ?? false,
            isTreasury: false,    // 이제 의미 없음(보스 단위)
            isDistributed: it.isDistributed ?? false,
          };
        });

        setSavedItems(mapped);
        setMode("list");
      } catch (e) {
        console.error("failed to load raid items", e);
        setSavedItems([]);
        setDraftRows(createInitialDraftRows());
        setLooterActiveIndexMap({});
        draftRowIdRef.current = 6;
        setMode("input");
      }
    })();
    }, [activeBossForPopup, selectedWeek, clanId, members]);

    /** 컷 + 분배방식 확정 처리 */
    async function confirmCutWithMode() {
    if (!selectedWeek || pendingCutBossId == null) return;

    // 1) 컷 + 분배방식 함께 서버로 전송 (백엔드에서 distributionMode 받도록 확장해야 함)
    await postJSON("/v1/pledge-raid/cut", {
        year: selectedWeek.year,
        month: selectedWeek.month,
        week: selectedWeek.week,
        clanId,
        bossMetaId: pendingCutBossId,
        distributionMode: selectedCutMode, // 🔹 새 필드
    });

    // 2) 클라이언트 내 컷 시간 기록
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const label = `${hh}:${mm}`;
    setCutTimeMap((prev) => ({ ...prev, [pendingCutBossId]: label }));

    // 3) 이 보스의 분배방식 프론트 캐시
    setBossDistributionMap((prev) => ({
        ...prev,
        [pendingCutBossId]: selectedCutMode,
    }));

    // 4) 다시 결과 조회하여 주차 진행상태 갱신
    const res = await postJSON<{ results: RaidResult[] }>(
        `/v1/pledge-raid/results?year=${selectedWeek.year}&month=${selectedWeek.month}&week=${selectedWeek.week}&clanId=${clanId}`
    );
    const results = res.results ?? [];
    setRaidResults(results);

    const totalBosses = bossMetas.length;
    let status: WeekStatus = "none";
    if (results.length === 0) status = "none";
    else if (totalBosses > 0 && results.length >= totalBosses) status = "all";
    else status = "partial";

    setWeekStatusMap((prev) => ({
        ...prev,
        [selectedWeek.weekKey]: status,
    }));

    // 5) 팝업 닫기
    setCutModeSelectorOpen(false);
    setPendingCutBossId(null);
    }

  /** 컷 여부 확인 */
  const isBossCut = (bossMetaId: number) =>
    raidResults.some((r) => r.bossMetaId === bossMetaId);

  function getWeekStatusView(status: WeekStatus) {
    switch (status) {
      case "all":
        return {
          bgClass: "bg-green-500",
          textClass: "text-white",
          symbol: "V",
          tooltip: "모든 몬스터 컷, 아이템 판매/분배까지 완료",
        };
      case "partial":
        return {
          bgClass: "bg-yellow-400",
          textClass: "text-black",
          symbol: "△",
          tooltip: "남은 작업 있음: 미컷/미판매/분배미완료 확인 필요",
        };
      case "none":
      default:
        return {
          bgClass: "bg-red-500",
          textClass: "text-white",
          symbol: "-",
          tooltip: "아직 어떤 레이드도 진행되지 않았습니다",
        };
    }
  }

  function getOwnerMonthYearBySunday(monday: Date) {
    const sunday = new Date(monday.getTime() + 6 * MS_DAY);
    const year = sunday.getFullYear();
    const month = sunday.getMonth() + 1;
    return {
      year,
      month,
      key: `${year}-${month}`,
    };
  }

  async function persistItemsToServer(items: DropItem[]) {
    if (!selectedWeek || !activeBossForPopup) return;

    const valid = items.filter(
      (it) => it.itemName.trim().length > 0 && it.looterId != null
    );

    const payload = {
      year: selectedWeek.year,
      month: selectedWeek.month,
      week: selectedWeek.week,
      clanId,
      bossMetaId: activeBossForPopup.bossMetaId,
      items: valid.map((it) => ({
        id: it.id > 0 ? String(it.id) : undefined,
        itemName: it.itemName,
        rootUserId: String(it.looterId),
        isSold: it.isSold,
        soldPrice: it.salePrice ?? 0,
        isTreasury: it.isTreasury,
      })),
    };

    // ✅ 이전 저장이 끝난 다음에만 다음 저장 요청이 나가도록 직렬화
    saveLockRef.current = saveLockRef.current.then(
      () => postJSON("/v1/pledge-raid/items/save", payload),
      () => postJSON("/v1/pledge-raid/items/save", payload),
    );

    return saveLockRef.current;
  }

  function handleClosePopup() {
    setActiveBossForPopup(null);
  
    setDistributionMode("ITEM");
    setPendingDistributionMode("ITEM");
    setModeSelectorOpen(false); // 항상 닫힌 상태로
  
    setDraftRows(createInitialDraftRows());
    setSavedItems([]);
    setLooterActiveIndexMap({});
    draftRowIdRef.current = 6;
    setMode("input");
  }

  /** 루팅자 선택 헬퍼 */
  function selectLooter(rowId: number, member: Member) {
    setDraftRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              looterId: member.id,
              looterInput: member.nickname || member.loginId,
            }
          : row
      )
    );
    setLooterActiveIndexMap((prev) => ({
      ...prev,
      [rowId]: 0,
    }));
  }

  /** 드랍 아이템 줄 추가 */
  function handleAddDraftRow() {
    setDraftRows((prev) => {
      if (prev.length >= MAX_DRAFT_ROWS) return prev;
      return [
        ...prev,
        {
          id: draftRowIdRef.current++,
          itemName: "",
          looterInput: "",
          looterId: null,
        },
      ];
    });
  }

  /** 행 삭제 (수정 모드에서 사용) */
  function handleDeleteRow(rowId: number) {
    const base = savedItems.find((it) => it.id === rowId);
    if (base && base.isSold && base.isDistributed) {
      alert(
        "혈원에게 분배된 아이템이라서 삭제가 불가능 합니다. 분배 취소 먼저 진행해 주세요."
      );
      return;
    }

    setDraftRows((prev) => prev.filter((r) => r.id !== rowId));
    // 실제 DB 반영은 저장 버튼에서 처리
  }

  /** 초안/수정 저장 → savedItems 재구성 + 서버 저장 + 리스트 모드 전환 */
  async function handleSaveDraftRows() {
    if (!activeBossForPopup || !selectedWeek) return;

    const validRows = draftRows.filter(
      (r) => r.itemName.trim().length > 0 && r.looterId !== null
    );

    // ✅ 0개도 허용: 서버에 빈 배열 저장(=기존 데이터 전부 삭제)
    if (validRows.length === 0) {

      await persistItemsToServer([]); // items: [] 전송

      setSavedItems([]);
      setMode("input"); // "list"로 두고 싶으면 "list"로 바꿔도 됨

      setDraftRows(createInitialDraftRows());
      setLooterActiveIndexMap({});
      draftRowIdRef.current = 6;
      return;
    }


    const nextItems: DropItem[] = validRows.map((r) => {
      const base = savedItems.find((it) => it.id === r.id);
      const mem = members.find((m) => m.id === r.looterId!);
      const looterName = mem?.nickname || mem?.loginId || r.looterInput;

      if (base) {
        return {
          ...base,
          itemName: r.itemName.trim().slice(0, 100),
          looterId: r.looterId!,
          looterName,
        };
      }

      return {
        id: 0, // ✅ 신규는 서버 id가 없음을 의미
        itemName: r.itemName.trim().slice(0, 100),
        looterId: r.looterId!,
        looterName,
        salePrice: null,
        isSold: false,
        isTreasury: false,
        isDistributed: false,
      };
    });

    await persistItemsToServer(nextItems);

    // ✅ 저장 후 서버에서 다시 로드(=id 동기화)
    const res = await postJSON<{ ok: boolean; isTreasury: boolean; items: RaidItemServer[] }>(
      "/v1/pledge-raid/items/list",
      { year: selectedWeek.year, month: selectedWeek.month, week: selectedWeek.week, clanId, bossMetaId: activeBossForPopup.bossMetaId }
    );

    setDistributionMode(res.isTreasury ? "TREASURY" : "ITEM");
    const items = res.items ?? [];
    const mapped: DropItem[] = items.map((it) => {
      const mem = members.find((m) => m.id === it.rootUserId);
      const looterName = mem?.nickname || mem?.loginId || String(it.rootUserId);

      return {
        id: Number(it.id),
        itemName: it.itemName,
        looterId: Number(it.rootUserId),
        looterName,
        salePrice: it.soldPrice ?? null,
        isSold: it.isSold ?? false,
        isTreasury: false,
        isDistributed: false,
      };
    });
    setSavedItems(mapped);
    setMode(items.length > 0 ? "list" : "input");

    setDraftRows(createInitialDraftRows());
    setLooterActiveIndexMap({});
  }

  /** 리스트 모드 → 수정 모드 진입 */
  function enterEditModeFromList() {
    // savedItems 기반으로 draftRows 재구성
    const rows: DraftRow[] = savedItems.map((it) => ({
      id: it.id,
      itemName: it.itemName,
      looterInput: it.looterName,
      looterId: it.looterId,
    }));

    // 최소 5줄 정도는 비어있는 행을 추가
    while (rows.length < 5) {
      rows.push({
        id: draftRowIdRef.current++,
        itemName: "",
        looterInput: "",
        looterId: null,
      });
    }

    setDraftRows(rows);
    setMode("edit");
  }

  async function handleCompleteSale(dropItemId: number) {
    const target = savedItems.find((x) => x.id === dropItemId);
    if (!target) return;

    if (target.salePrice == null || target.salePrice <= 0) {
      alert("판매금액을 먼저 입력해주세요.");
      return;
    }

    const nextItems = savedItems.map((item) => {
      if (item.id !== dropItemId) return item;
      if (distributionMode === "TREASURY") return { ...item, isSold: true, isTreasury: true };
      return { ...item, isSold: true, isTreasury: false };
    });

    setSavedItems(nextItems);
    await persistItemsToServer(nextItems); // ✅ fire-and-forget 금지
  }

  /** 상태 텍스트 */
  function getSaleStatusText(item: DropItem): string {
    if (!item.isSold) return "판매 전";
    if (item.isTreasury) return "혈비 귀속";
    if (!item.isDistributed) return "분배 진행 중";
    return "분배 완료";
  }

  return (
    <div className="w-full h-screen flex bg-white text-black">
      {/* LEFT: 주차 리스트 */}
      <div className="w-1/5 h-full border-r border-gray-300 flex flex-col bg-white">
        <div className="px-4 py-4 font-extrabold text-xl border-b border-gray-300">
          주차별 레이드
        </div>

        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-4 py-3 text-sm"
          onScroll={handleScroll}
          onWheel={handleWheel}
        >
          {weekItems.map((item, idx) => {
            const isSelected =
              selectedWeek?.year === item.year &&
              selectedWeek?.month === item.month &&
              selectedWeek?.week === item.week;

            const owner = getOwnerMonthYearBySunday(item.monday);
            const prevOwner =
              idx > 0
                ? getOwnerMonthYearBySunday(weekItems[idx - 1].monday)
                : null;

            const showMonthHeader = !prevOwner || prevOwner.key !== owner.key;

            const status: WeekStatus = weekStatusMap[item.weekKey] ?? "none";
            const { bgClass, textClass, symbol, tooltip } =
              getWeekStatusView(status);

            const rangeLabel = formatWeekRange(item.monday);

            return (
              <div key={item.weekKey ?? item.index} className="mb-3">
                {showMonthHeader && (
                  <div className="pt-2 mt-2 mb-1 border-t border-gray-300 text-xs text-gray-500 font-semibold">
                    {owner.year}년 {owner.month}월
                  </div>
                )}

                <div
                  className="py-2 min-h-[40px] cursor-pointer"
                  onClick={() => {
                    setSelectedWeek(item);
                    // 다른 주 선택 시 팝업 초기화
                    handleClosePopup();
                  }}
                  title={tooltip}
                >
                  <div className="flex items-start gap-2">
                    {/* 상태 아이콘 */}
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${bgClass} ${textClass}`}
                    >
                      {symbol}
                    </div>

                    {/* 텍스트 영역 */}
                    <div className="flex flex-col">
                      <div
                        className={`font-semibold text-base ${
                          isSelected ? "text-red-600" : "text-black"
                        }`}
                      >
                        {item.week}주차 레이드
                      </div>

                      {/* 주차 날짜 범위 */}
                      <div className="text-xs text-gray-500 mt-0.5">
                        {rangeLabel}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT: 보스 카드 + 팝업 */}
      <div className="w-4/5 h-full bg-white p-4 overflow-y-auto">
        {selectedWeek && (
          <>
            <div className="mb-4">
              <h1 className="text-2xl font-bold mb-1">
                {selectedWeek.year}년 {selectedWeek.month}월{" "}
                {selectedWeek.week}주차 레이드
              </h1>
              <p className="text-sm text-gray-600">
                기준 월요일: {selectedWeek.monday.toISOString().slice(0, 10)}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {bossMetas.map((boss) => {
                const cut = isBossCut(boss.bossMetaId);
                const cutLabel = cutTimeMap[boss.bossMetaId]
                  ? `컷 시간: ${cutTimeMap[boss.bossMetaId]}`
                  : "컷 완료";

                return (
                  <div
                    key={boss.bossMetaId}
                    className="border border-gray-300 rounded-2xl px-4 py-3 h-[13vh] flex items-center"
                  >
                    {/* 왼쪽: 텍스트 영역 */}
                    <div className="flex flex-col justify-center">
                      <div
                        className={`text-lg font-bold mb-3 ${getBossColor(
                          boss.raidLevel
                        )}`}
                      >
                        {boss.bossName}
                      </div>

                      <div className="text-gray-700 text-sm">
                        참여 인원: <strong>0명</strong>
                      </div>

                      <div className="text-gray-700 text-sm mt-1">
                        아이템 개수: <strong>{savedItems.length}개</strong>
                      </div>
                    </div>

                    {/* 오른쪽: 버튼 + 상태 */}
                    <div className="ml-auto flex flex-col items-end justify-between h-full py-1">
                        {!cut ? (
                        <button
                            onClick={() => {
                            // 먼저 보스 ID 저장 후 분배 방식 선택 팝업 오픈
                            setPendingCutBossId(boss.bossMetaId);
                            setSelectedCutMode("ITEM"); // 기본값: 혈원 분배
                            setCutModeSelectorOpen(true);
                            }}
                            className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-sm"
                        >
                            컷
                        </button>
                        ) : (
                        <button
                            onClick={() => setActiveBossForPopup(boss)}
                            className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 text-black rounded text-sm"
                        >
                            정보입력
                        </button>
                        )}
                      <div className="text-xs text-gray-500 mt-1">
                        {!cut ? "미완료" : cutLabel}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* 정보입력 팝업 */}
      {activeBossForPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-lg w-[900px] max-w-[95vw] p-5 relative">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex flex-col">
                <span className="text-sm text-gray-500">
                  {selectedWeek &&
                    `${selectedWeek.year}년 ${selectedWeek.month}월 ${selectedWeek.week}주차`}
                </span>
                <span className="text-lg font-bold mt-1">
                  {activeBossForPopup.bossName} 레이드 결과 입력
                </span>
              </div>
              <button
                onClick={handleClosePopup}
                className="text-gray-500 hover:text-black text-xl leading-none"
              >
                ×
              </button>
            </div>

            {/* 본문: 좌측(드랍 아이템) / 우측(참여 인원) */}
            <div className="flex gap-4">
              {/* LEFT: 드랍 아이템 / 루팅자 */}
              <div className="flex-[1.5] border border-gray-200 rounded-xl p-3">
                {mode === "list" ? (
                    // ───────────────── 리스트 모드 (테이블형) ─────────────────
                    <div className="text-xs">
                    {/* 타이틀: 고정 문구 */}
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold">드랍 아이템 목록</span>
                    </div>

                    {savedItems.length === 0 ? (
                        <div className="text-[11px] text-gray-500 border border-gray-200 rounded px-2 py-2 bg-gray-50">
                        등록된 아이템이 없습니다. 아래 <strong>수정</strong> 버튼을 눌러
                        아이템을 입력해 주세요.
                        </div>
                    ) : (
                        <>
                        {/* 헤더 라인 */}
                        <div className="grid grid-cols-[2fr,1.4fr,1.2fr,1.4fr] text-[11px] font-semibold text-gray-500 border-b border-gray-200 pb-1 mb-1">
                            <div>아이템</div>
                            <div>루팅자</div>
                            <div>판매가</div>
                            <div className="text-right">진행상태</div>
                        </div>

                        {/* 데이터 행들 */}
                        <div className="divide-y divide-gray-100">
                            {savedItems.map((item) => {
                            const isLooter = user != null && String(item.looterId) === String(user.id);
                            const canManage = isLooter || isClanAdmin(user);

                            // 판매가 컬럼
                            let saleNode: React.ReactNode;
                            if (!item.isSold) {
                                if (canManage) {
                                // 내가 루팅자 → 입력 가능
                                saleNode = (
                                    <input
                                    type="number"
                                    className="border border-gray-300 rounded px-2 py-0.5 w-24 text-right text-[12px]"
                                    value={item.salePrice ?? ""}
                                    placeholder="0"
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        const num = v === "" ? null : Number(v);
                                        setSavedItems((prev) =>
                                        prev.map((x) =>
                                            x.id === item.id ? { ...x, salePrice: num } : x
                                        )
                                        );
                                    }}
                                    />
                                );
                                } else {
                                // 내가 루팅자 아님 → 판매가 표시 안 함
                                saleNode = <span>-</span>;
                                }
                            } else {
                                // 이미 판매된 아이템
                                saleNode = (
                                <span>
                                    {item.salePrice != null ? item.salePrice.toLocaleString() : "-"}
                                </span>
                                );
                            }

                            // 진행상태 컬럼
                            let actionNode: React.ReactNode;

                            if (!item.isSold) {
                                if (canManage) {
                                // 판매 전 + 내 아이템 → 판매완료 버튼
                                actionNode = (
                                    <button
                                    type="button"
                                    onClick={() => handleCompleteSale(item.id)}
                                    className="px-2 py-0.5 rounded bg-blue-600 text-white text-[11px]"
                                    >
                                    판매완료처리
                                    </button>
                                );
                                } else {
                                // 판매 전 + 남의 아이템 → 텍스트만
                                actionNode = (
                                    <span className="text-[11px] text-gray-700">판매중</span>
                                );
                                }
                            } else if (distributionMode === "ITEM" && !item.isDistributed) {
                              if (canManage) {
                                actionNode = (
                                  <button
                                    type="button"
                                    className="px-2 py-0.5 rounded bg-blue-600 text-white text-[11px]"
                                    onClick={() => {
                                      alert("분배하기 버튼 클릭됨 (로직 미구현)");
                                    }}
                                  >
                                    분배하기
                                  </button>
                                );
                              } else {
                                actionNode = (
                                  <span className="text-[11px] text-gray-700">분배 진행 중</span>
                                );
                              }
                            } else if (distributionMode === "TREASURY") {
                              actionNode = (
                                <span className="px-2 py-0.5 rounded bg-green-600 text-white text-[11px]">
                                  혈비귀속 완료
                                </span>
                              );
                            } else {
                                // 분배 완료
                                actionNode = (
                                <span className="text-[11px] font-semibold text-green-600">
                                    분배 완료
                                </span>
                                );
                            }

                            return (
                                <div
                                key={item.id}
                                className="grid grid-cols-[2fr,1.4fr,1.2fr,1.6fr] items-center py-1.5 text-[13px] border-b border-gray-100 last:border-b-0"
                                >
                                {/* 아이템 */}
                                <div className="truncate">{item.itemName}</div>

                                {/* 루팅자 */}
                                <div className="truncate">{item.looterName}</div>

                                {/* 판매가 */}
                                <div>{saleNode}</div>

                                {/* 진행상태 */}
                                <div className="flex justify-end">{actionNode}</div>
                                </div>
                            );
                            })}
                        </div>
                        </>
                    )}

                    {/* 리스트 하단: 수정 버튼 (원래 저장 버튼 위치로 이동) */}
                    <div className="flex items-center justify-end mt-3">
                        <button
                        type="button"
                        onClick={enterEditModeFromList}
                        className="px-3 py-1 rounded text-xs bg-gray-800 text-white hover:bg-black"
                        >
                        수정
                        </button>
                    </div>
                    </div>
                ) : (
                  // ───────────────── 입력 / 수정 모드 ─────────────────
                  <>
                    <div className="text-sm font-semibold mb-2">드랍 아이템 목록</div>

                    <div className="space-y-2 mb-2 max-h-56 overflow-y-auto pr-1">
                      {draftRows.map((row) => {
                        const q = row.looterInput;
                        const filteredMembers =
                          q.trim().length === 0
                            ? []
                            : members.filter((m) => {
                                const name =
                                  m.nickname || m.loginId || "";
                                return koreanMatch(name, q);
                              });
                        const activeIndex =
                          looterActiveIndexMap[row.id] ?? 0;

                        const baseItem = savedItems.find(
                          (it) => it.id === row.id
                        );
                        const locked =
                          mode === "edit" && baseItem?.isSold === true;

                        return (
                          <div
                            key={row.id}
                            className="flex gap-2 text-xs items-start"
                          >
                            {/* 아이템명 */}
                            <input
                              type="text"
                              className={`flex-[1.2] border border-gray-300 rounded px-2 py-1 ${
                                locked ? "bg-gray-100" : ""
                              }`}
                              maxLength={100}
                              placeholder="드랍 아이템명 (최대 100자)"
                              value={row.itemName}
                              disabled={locked}
                              onChange={(e) =>
                                setDraftRows((prev) =>
                                  prev.map((r) =>
                                    r.id === row.id
                                      ? { ...r, itemName: e.target.value }
                                      : r
                                  )
                                )
                              }
                            />

                            {/* 루팅자 + 자동완성 */}
                            <div className="relative flex-1">
                              <input
                                type="text"
                                className={`w-full border border-gray-300 rounded px-2 py-1 ${
                                  locked ? "bg-gray-100" : ""
                                }`}
                                placeholder="루팅자 검색"
                                value={row.looterInput}
                                disabled={locked}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setDraftRows((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id
                                        ? {
                                            ...r,
                                            looterInput: v,
                                            looterId: null,
                                          }
                                        : r
                                    )
                                  );
                                }}
                                onKeyDown={(e) => {
                                  if (
                                    locked ||
                                    filteredMembers.length === 0
                                  )
                                    return;

                                  if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    setLooterActiveIndexMap((prev) => ({
                                      ...prev,
                                      [row.id]:
                                        (activeIndex + 1) %
                                        filteredMembers.length,
                                    }));
                                  } else if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    setLooterActiveIndexMap((prev) => ({
                                      ...prev,
                                      [row.id]:
                                        (activeIndex -
                                          1 +
                                          filteredMembers.length) %
                                        filteredMembers.length,
                                    }));
                                  } else if (e.key === "Enter") {
                                    e.preventDefault();
                                    const target =
                                      filteredMembers[activeIndex] ??
                                      filteredMembers[0];
                                    if (target) {
                                      selectLooter(row.id, target);
                                    }
                                  }
                                }}
                              />

                              {row.looterInput.length > 0 &&
                                row.looterId === null &&
                                filteredMembers.length > 0 &&
                                !locked && (
                                  <div className="absolute left-0 right-0 mt-1 max-h-40 overflow-y-auto bg-white border border-gray-300 rounded shadow text-xs z-10">
                                    {filteredMembers
                                      .slice(0, 8)
                                      .map((m, idx) => {
                                        const display =
                                          m.nickname || m.loginId || "";
                                        const active =
                                          idx === activeIndex;
                                        return (
                                          <div
                                            key={m.id}
                                            className={`px-2 py-1 cursor-pointer ${
                                              active
                                                ? "bg-blue-600 text-white"
                                                : "hover:bg-gray-100"
                                            }`}
                                            onMouseDown={(e) => {
                                              e.preventDefault();
                                              selectLooter(row.id, m);
                                            }}
                                          >
                                            {display}
                                          </div>
                                        );
                                      })}
                                  </div>
                                )}
                            </div>

                            {/* 삭제 버튼 (수정 모드에서만) */}
                            {mode === "edit" && (
                              <button
                                type="button"
                                className="mt-1 text-[11px] text-red-600"
                                onClick={() => handleDeleteRow(row.id)}
                              >
                                삭제
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* 추가 / 저장 / (edit 전용) 취소 버튼 */}
                    <div className="flex items-center justify-between mt-1">
                    <button
                        type="button"
                        onClick={handleAddDraftRow}
                        className="text-xs text-blue-600 hover:underline"
                    >
                        + 추가
                    </button>

                    <div className="flex items-center gap-2">
                        {mode === "edit" && (
                        <button
                            type="button"
                            onClick={() => {
                            // 수정 취소 → 리스트 모드로 복귀 + 초안 리셋
                            setMode("list");
                            setDraftRows(createInitialDraftRows());
                            setLooterActiveIndexMap({});
                            }}
                            className="px-3 py-1 rounded text-xs border border-gray-300 text-gray-700 hover:bg-gray-100"
                        >
                            취소
                        </button>
                        )}

                        <button
                        type="button"
                        onClick={handleSaveDraftRows}
                        className="px-3 py-1 rounded text-xs bg-gray-800 text-white hover:bg-black"
                        >
                        저장
                        </button>
                    </div>
                    </div>
                  </>
                )}
              </div>

              {/* RIGHT: 참여 인원 (현재는 설명만) */}
              <div className="flex-1 border border-gray-200 rounded-xl p-3 bg-gray-50">
                <div className="text-sm font-semibold mb-2">
                  참여 인원 (추후 상세 입력 예정)
                </div>

                {distributionMode === "ITEM" ? (
                  <div className="opacity-50 pointer-events-none text-xs text-gray-500 space-y-2">
                    <p>
                      분배 아이템 모드에서는 우선 드랍 아이템 / 판매 여부 /
                      판매 금액만 입력합니다.
                    </p>
                    <p>
                      참여 인원별 분배 내역 입력은 추후 단계에서
                      구현합니다. 현재는 비활성화 상태입니다.
                    </p>

                    <div className="border border-dashed border-gray-300 rounded px-2 py-2">
                      <div className="mb-1 font-semibold text-gray-600">
                        참여자 예시 (비활성)
                      </div>
                      <div className="space-y-1 text-[11px]">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            disabled
                            className="w-3 h-3"
                          />
                          <span>혈원A</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            disabled
                            className="w-3 h-3"
                          />
                          <span>혈원B</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 space-y-2">
                    <p>
                      혈비 귀속 모드에서는 아이템 판매 금액이 혈비로
                      귀속됩니다.
                    </p>
                    <p>
                      판매완료 버튼을 누르면 해당 아이템은{" "}
                      <span className="font-semibold">혈비귀속 완료</span>로
                      표시되고, 추가 분배 작업은 필요 없습니다.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* 푸터 */}
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={handleClosePopup}
                className="px-4 py-2 text-sm rounded border border-gray-300 hover:bg-gray-100"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────── 분배 방식 선택 오버레이 ───────── */}
      {modeSelectorOpen && (
        <div className="absolute inset-0 bg-white/90 rounded-2xl flex items-center justify-center">
          <div className="w-[420px] max-w-[90%] bg-white border border-gray-200 rounded-2xl shadow-lg p-5 text-sm">
            <div className="font-semibold mb-4">
              해당 레이드의 분배 방식을 선택해주세요.
            </div>

            {/* 상단: 분배 방식 표시만 */}
            <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-700">
                처리 방식
                </span>
                <span className="px-3 py-1 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200">
                {distributionMode === "ITEM" ? "혈원 분배" : "혈비 귀속"}
                </span>
            </div>

            {distributionMode === "ITEM" && (
                <span className="text-[11px] text-gray-500">
                ※ 이후 혈비 귀속으로 변경 시 판매·분배 정보가 초기화될 수 있습니다.
                </span>
            )}
            </div>

            {/* 경고 문구 */}
            <p className="text-xs text-gray-500 mb-4 leading-relaxed">
              혈원분배로 저장하시고 추 후 혈비 귀속으로 변경하시려고 하면
              판매 정보와 분배정보가 사라질 수 있으니 주의해주세요.
            </p>

            {/* 저장 버튼 */}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-1.5 rounded text-xs border border-gray-300 text-gray-700 hover:bg-gray-100"
                onClick={handleClosePopup}
              >
                취소
              </button>
              <button
                type="button"
                className="px-4 py-1.5 rounded text-xs bg-gray-800 text-white hover:bg-black"
                onClick={() => {
                  setDistributionMode(pendingDistributionMode);
                  setModeSelectorOpen(false);
                }}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {cutModeSelectorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl shadow-lg w-[420px] max-w-[90vw] p-5">
            <div className="text-base font-bold mb-1">분배 방식 선택</div>
            <p className="text-xs text-gray-600 mb-4">
                해당 레이드의 분배 방식을 선택해 주세요.
            </p>

            <div className="flex gap-3 mb-3">
                <button
                type="button"
                onClick={() => setSelectedCutMode("ITEM")}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm ${
                    selectedCutMode === "ITEM"
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-gray-300 bg-white text-gray-700"
                }`}
                >
                혈원 분배
                </button>
                <button
                type="button"
                onClick={() => setSelectedCutMode("TREASURY")}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm ${
                    selectedCutMode === "TREASURY"
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-gray-300 bg-white text-gray-700"
                }`}
                >
                혈비 귀속
                </button>
            </div>

            <p className="text-[11px] text-red-500 mb-4">
                혈원 분배로 저장한 뒤 나중에 혈비 귀속으로 변경하려고 하면
                <br />
                판매 정보와 분배 정보가 사라질 수 있으니 주의해주세요.
            </p>

            <div className="flex justify-end gap-2">
                <button
                type="button"
                className="px-3 py-1 text-xs rounded border border-gray-300 hover:bg-gray-50"
                onClick={() => {
                    setCutModeSelectorOpen(false);
                    setPendingCutBossId(null);
                }}
                >
                취소
                </button>
                <button
                type="button"
                className="px-3 py-1 text-xs rounded bg-gray-800 text-white hover:bg-black"
                onClick={confirmCutWithMode}
                >
                저장
                </button>
            </div>
            </div>
        </div>
        )}
    </div>
  );
}