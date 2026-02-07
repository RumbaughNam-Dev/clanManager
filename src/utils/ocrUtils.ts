/**
 * OCR 및 이미지 처리 유틸
 * Tesseract.js를 사용하여 이미지에서 텍스트 추출
 */

// 간단한 문자 유사도 계산 (Levenshtein 거리)
export function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const len1 = s1.length;
  const len2 = s2.length;

  // 너무 길이가 다르면 매칭 불가능
  if (Math.abs(len1 - len2) > Math.max(len1, len2) * 0.3) return 0;

  // 간단한 거리 계산
  let matches = 0;
  for (let i = 0; i < Math.min(len1, len2); i++) {
    if (s1[i] === s2[i]) matches++;
  }

  return matches / Math.max(len1, len2);
}

// 한글 자모 분리
export function isKoreanChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3; // 한글 범위
}

// 유사한 글자 필터링
const CONFUSING_CHARS: Record<string, string[]> = {
  O: ["0", "D", "Q"],
  "0": ["O"],
  l: ["I", "1"],
  I: ["l", "1"],
  "1": ["l", "I"],
  S: ["5"],
  "5": ["S"],
  Z: ["2"],
  "2": ["Z"],
  // 한글도 추가 가능
  이: ["아"],
  오: ["영"],
};

// OCR 결과에서 추출된 이름들을 정제
export function normalizeOCRText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ") // 공백 정규화
    .replace(/[^가-힣a-zA-Z0-9\s\-_]/g, ""); // 특수문자 제거
}

// 혈맹원 목록과 OCR 결과 매칭
export interface MatchResult {
  ocrText: string;
  memberId: number | null;
  memberName: string;
  confidence: number; // 0~1
  alternatives: Array<{
    memberId: number;
    memberName: string;
    confidence: number;
  }>;
}

export function matchMembersWithOCR(
  ocrNames: string[],
  members: Array<{ id: number; nickname: string | null; loginId: string }>
): MatchResult[] {
  return ocrNames.map((ocrText) => {
    const normalized = normalizeOCRText(ocrText);

    if (!normalized) {
      return {
        ocrText,
        memberId: null,
        memberName: "",
        confidence: 0,
        alternatives: [],
      };
    }

    // 각 혈맹원과의 유사도 계산
    const scores = members.map((member) => {
      const name = member.nickname || member.loginId;
      const similarity = calculateSimilarity(normalized, name);
      return { member, similarity };
    });

    // 상위 매칭 결과 정렬
    scores.sort((a, b) => b.similarity - a.similarity);

    const bestMatch = scores[0];

    // 신뢰도가 낮으면 null로 처리
    const confidence = bestMatch.similarity;
    const acceptedConfidence = 0.6; // 60% 이상만 자동 매칭

    return {
      ocrText,
      memberId: confidence >= acceptedConfidence ? bestMatch.member.id : null,
      memberName:
        confidence >= acceptedConfidence
          ? bestMatch.member.nickname || bestMatch.member.loginId
          : "",
      confidence,
      alternatives: scores
        .slice(1, 4) // 상위 3개 대안
        .map(({ member, similarity }) => ({
          memberId: member.id,
          memberName: member.nickname || member.loginId,
          confidence: similarity,
        })),
    };
  });
}

// 이미지를 base64로 변환
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 간단한 이미지 전처리
export function preprocessImage(
  canvas: HTMLCanvasElement,
  brightness: number = 1,
  contrast: number = 1
): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // 밝기 조정
    r = Math.min(255, r * brightness);
    g = Math.min(255, g * brightness);
    b = Math.min(255, b * brightness);

    // 명도 대비 조정
    const avg = (r + g + b) / 3;
    r = Math.min(255, avg + (r - avg) * contrast);
    g = Math.min(255, avg + (g - avg) * contrast);
    b = Math.min(255, avg + (b - avg) * contrast);

    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
