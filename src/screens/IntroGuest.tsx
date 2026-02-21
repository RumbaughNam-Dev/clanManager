export default function IntroGuest() {
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

      <div className="relative w-full h-full flex flex-col justify-center gap-8 p-8 md:p-12">
        <div className="space-y-3 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70">
            Clan Manager
          </div>
          <h1 className="text-3xl md:text-4xl font-black">보스 컷/분배/혈비까지 한 번에 관리</h1>
          <p className="text-sm md:text-base text-white/70">
            혈맹 운영이 가장 빠르게 정돈되는 곳.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {[
            {
              title: "간편한 보스 컷 관리",
              body: "컷 시간만 기록하면 메타 데이터를 활용해 다음 젠 시간을 자동 계산해요.",
            },
            {
              title: "루팅/참여자 기록",
              body: "루팅자/참여자/드랍 아이템을 기록하고, 판매 완료 시 자동 정산까지 도와줘요.",
            },
            {
              title: "자동 분배 계산",
              body: "판매 금액에서 수수료를 제하고 인원수로 자동 분배해 금액을 보여줘요.",
            },
            {
              title: "혈비 귀속 옵션",
              body: "애매한 템은 혈비 귀속으로 관리, 판매/귀속 이력도 투명하게 남아요.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/80"
            >
              <div className="text-base font-semibold text-white">{item.title}</div>
              <div className="mt-2 text-white/70">{item.body}</div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-white/80">
          <div className="text-base font-semibold text-white">혈비 입출금 이력 관리</div>
          <div className="mt-2 text-white/70">
            혈비는 유입/사용 처리로 관리하며, 언제 어디서 유입·사용되었는지 전체 이력을 확인할 수 있어요.
          </div>
        </div>
      </div>
    </div>
  );
}
