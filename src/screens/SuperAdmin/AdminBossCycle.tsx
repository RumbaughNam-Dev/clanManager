import Card from "../../components/common/Card";
import PageHeader from "../../components/common/PageHeader";
import { useAuth } from "../../contexts/AuthContext";

export default function AdminBossCycle() {
  const { role } = useAuth();
  if (role !== "SUPERADMIN") {
    return <div className="text-sm text-red-600">접근 권한이 없습니다.</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader title="보스 젠 주기 관리" subtitle="주기 수정 요청 검토/적용 (목업 화면)" />
      <Card>
        <div className="text-sm text-gray-600">요청 리스트/메타 수정 UI는 추후 API 연동 시 구현</div>
        <ul className="mt-2 text-sm text-gray-500 list-disc pl-5">
          <li className="italic">대기중 요청 0건</li>
        </ul>
      </Card>
    </div>
  );
}