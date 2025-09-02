import Card from "../components/common/Card";

export default function IntroGuest() {
  return (
    <div className="max-w-5xl mx-auto">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-extrabold">Clan Manager</h1>
              <p className="mt-2 text-sm text-slate-600">보스 컷/분배/혈비까지 한 번에 관리</p>
            </div>
      
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <h3 className="font-semibold mb-1">간편한 보스 컷 관리</h3>
                <p className="text-sm text-slate-600">
                  컷 시간만 기록하면 메타 데이터를 활용해 <span className="font-medium">다음 젠 시간</span>을 자동 계산해요.
                </p>
              </Card>
              <Card>
                <h3 className="font-semibold mb-1">루팅/참여자 기록</h3>
                <p className="text-sm text-slate-600">
                  <span className="font-medium">루팅자/참여자/드랍 아이템</span>을 기록하고, 판매 완료 시 자동 정산까지 도와줘요.
                </p>
              </Card>
              <Card>
                <h3 className="font-semibold mb-1">자동 분배 계산</h3>
                <p className="text-sm text-slate-600">
                  판매 금액에서 수수료를 제하고 <span className="font-medium">인원수로 자동 분배</span>해 금액을 보여줘요.
                </p>
              </Card>
              <Card>
                <h3 className="font-semibold mb-1">혈비 귀속 옵션</h3>
                <p className="text-sm text-slate-600">
                  애매한 템은 <span className="font-medium">혈비 귀속</span>으로 관리, 판매/귀속 이력도 투명하게 남아요.
                </p>
              </Card>
            </div>
      
            <Card>
              <h3 className="font-semibold mb-2">혈비 입출금 이력 관리</h3>
              <p className="text-sm text-slate-600">
                혈비는 <span className="font-medium">유입/사용 처리</span>로 관리하며,
                언제 어디서 유입·사용되었는지 <span className="font-medium">전체 이력</span>을 확인할 수 있어요.
              </p>
            </Card>
          </div>
    </div>
  );
}