// src/screens/dashboard/ForgottenCard.tsx
import React from "react";
import BossCard from "./BossCard";
import type { BossDto } from "../../types";

type Props = {
  b: BossDto;
  onCut: (b: BossDto) => void;
  /** 부모가 라벨을 오버라이드하고 싶으면 사용 */
  extraNextLabel?: string;
};

export default function ForgottenCard({ b, onCut, extraNextLabel }: Props) {
  // 잊어버린 보스는 "예상 다음 젠"을 계산해서 BossCard에 넘겨줌
  let predicted: string | null = null;
  if (b.lastCutAt && b.respawn > 0) {
    const lastMs = new Date(b.lastCutAt).getTime();
    if (!Number.isNaN(lastMs)) {
      const respawnMs = Math.round(b.respawn * 60 * 1000);
      const diff = Date.now() - lastMs;
      const k = Math.max(1, Math.ceil(diff / respawnMs));
      predicted = new Date(lastMs + k * respawnMs).toISOString();
    }
  }

  return (
    <BossCard
      b={{ ...b, nextSpawnAt: predicted ?? b.nextSpawnAt ?? null }}
      onCut={onCut}
      extraNextLabel={extraNextLabel ?? "예상 다음 젠"}
    />
  );
}