import React, { useMemo, useState } from "react";
import { postJSON } from "@/lib/http";

// 스크린샷에 있던 서버(월드) 목록에서 "전체"는 제외
const WORLD_NAMES = [
  "데포","판도","듀크","파푸","린드","군터","하딘","아툰","케레","이실",
  "켄라","데스","안타","발라","사이","질리","블루","라스","기르","그림리퍼",
  "발록","진 기르타스","말하는섬","원다우드","글루디오","그레시아"
] as const;
type WorldName = typeof WORLD_NAMES[number];

type CreateClanRequestResponse = {
  ok: true;
  data: { id: string; status: "PENDING" | "APPROVED" | "REJECTED"; createdAt: string };
};

type Props = {
  onSuccess?: () => void; // ✅ 등록 성공 후 페이지 전환용 (대시보드 이동)
};

export default function Signup({ onSuccess }: Props) {
  const [world, setWorld] = useState<WorldName | null>(null);
  const [serverNo, setServerNo] = useState<number | null>(null);

  // 폼 입력
  const [clanName, setClanName] = useState("");    // 혈맹 이름
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [depositor, setDepositor] = useState("");  // 입금자 명
  const [submitting, setSubmitting] = useState(false);

  const isReady = useMemo(
    () => !!world && !!serverNo && !!clanName && !!loginId,
    [world, serverNo, clanName, loginId]
  );

  const fullServerLabel = world && serverNo ? `${world}${serverNo}서버` : "-";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isReady || submitting) return;

    setSubmitting(true);
    try {
      await postJSON<CreateClanRequestResponse>("/v1/clan-requests", {
        world, serverNo, clanName, loginId, password, depositor,
      });

      alert(
        [
          "혈맹 등록이 완료되었습니다.",
          "지금 바로 클랜 매니저를 사용할 수 있습니다.",
        ].join("\n")
      );

      // ✅ 자동 로그인 금지: setUser 같은 세션 갱신 안 함
      // → 대신 대시보드로만 이동
      onSuccess?.();

    } catch (err: any) {
            if (err?.status === 409 && err?.body) {
        const code = err.body.code || "";
        if (code === "DUP_CLAN_NAME") {
          alert("이미 등록된 서버의 혈맹명입니다.");
          return;
        }
        if (code === "DUP_LOGIN_ID") {
          alert("이미 등록된 아이디 입니다.");
          return;
        }
      }
      // 일반 메시지
      alert(`요청 실패: ${err?.body?.message ?? err.message ?? "알 수 없는 오류"}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-slate-950 text-white"
      style={{ fontFamily: '"Space Grotesk", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif' }}
    >
      <div className="absolute inset-0">
        <div className="absolute -top-24 -right-20 h-56 w-56 rounded-full bg-emerald-400/30 blur-3xl" />
        <div className="absolute bottom-[-120px] left-[-60px] h-72 w-72 rounded-full bg-sky-400/25 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%)]" />
      </div>

      <div className="relative min-h-screen w-full flex items-center justify-center px-6 pt-28 pb-16">
        <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-slate-900/80 p-6 text-white shadow-2xl">
          <div className="mb-4">
            <h1 className="text-2xl font-bold">혈맹 등록 요청</h1>
            <p className="text-sm text-white/70">
              서버 선택 → 혈맹/계정 정보 입력 → 요청 제출 (즉시 사용 가능)
            </p>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
          {/* 1) 서버(월드) 선택 */}
          <section className="space-y-2">
            <div className="font-semibold">서버 선택</div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {WORLD_NAMES.map((w) => {
                const selected = world === w;
                return (
                  <button
                    key={w}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => { setWorld(w); setServerNo(null); }}
                    className={[
                      "px-4 py-2 rounded-xl border text-sm transition-colors",
                      selected
                        ? "bg-white/15 text-white border-white/20"
                        : "bg-white/5 hover:bg-white/10 border-white/10 text-white/80"
                    ].join(" ")}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
            {!world && <p className="text-xs text-amber-700">먼저 서버를 선택하세요.</p>}
          </section>

          {/* 2) 서버 번호 선택 (1~10) */}
          <section className="space-y-2">
            <div className="font-semibold">서버 번호 선택 (1~10)</div>
            <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                const selected = serverNo === n;
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={!world}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setServerNo(n)}
                    className={[
                      "px-3 py-2 rounded-xl border text-sm transition-colors",
                      !world
                        ? "opacity-50 cursor-not-allowed"
                        : selected
                        ? "bg-white/15 text-white border-white/20"
                        : "bg-white/5 hover:bg-white/10 border-white/10 text-white/80"
                    ].join(" ")}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            {world && !serverNo && <p className="text-xs text-amber-700">서버 번호를 선택하세요.</p>}
          </section>

          {/* 3) 혈맹/계정 정보 */}
          <section className="space-y-3">
            <div className="font-semibold">혈맹 및 계정 정보</div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1">혈맹 이름</label>
                <input className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/20" placeholder="예: 징벌"
                  value={clanName} onChange={(e) => setClanName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm mb-1">선택된 서버</label>
                <input className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white/80" value={fullServerLabel} readOnly />
              </div>
              <div>
                <label className="block text-sm mb-1">아이디</label>
                <input className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/20" placeholder="관리자 ID"
                  value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" />
              </div>
            </div>
          </section>

          {/* 4) 입금 안내 */}
          {/* <section className="space-y-2">
            <div className="font-semibold">입금 안내</div>
            <div className="rounded-xl border p-3 text-sm bg-gray-50">
              <div><span className="font-medium">은행</span> · 국민은행</div>
              <div><span className="font-medium">계좌</span> · 609301-04-173050</div>
              <div><span className="font-medium">예금주</span> · 남상현</div>
              <div><span className="font-medium">이용료</span> · 월 30,000원</div>
            </div>
          </section> */}

          {/* 5) 제출 */}
          <div className="pt-2 flex items-center justify-between gap-3">
            <div className="text-sm text-white/65 space-y-1">
              <p>
                <span className="mr-1">•</span>
                초기 비밀번호는 <span className="font-semibold">1234</span>로 자동 설정됩니다. 로그인 후 반드시 비밀번호를 변경해 주세요.
              </p>
              <p>
                <span className="mr-1">•</span>
                제출 즉시 사용이 활성화됩니다. 문제가 있을 경우 <span className="font-medium">010-3934-5039</span>로 문의해 주세요.
              </p>
            </div>
            <button
              type="submit"
              disabled={!isReady || submitting}
              className={`px-5 py-2 rounded-xl font-bold ${
                isReady && !submitting
                  ? "bg-white text-slate-900 hover:bg-emerald-100"
                  : "bg-white/30 text-white/70 cursor-not-allowed"
              }`}
            >
              {submitting ? "전송 중..." : "혈맹 등록 요청"}
            </button>
          </div>
          </form>
        </div>
      </div>
    </div>
  );
}
