import type React from "react";
import { useState, useRef } from "react";
import { matchMembersWithOCR, normalizeOCRText } from "@/utils/ocrUtils";

interface Member {
  id: number;
  loginId: string;
  nickname: string | null;
}

interface ScreenshotOCRProps {
  members: Member[];
  onSelect: (selectedMembers: Array<{ name: string; memberId: number | null }>) => void;
  onClose: () => void;
}

// Tesseract.js 간단한 대체용 - 실제로는 백엔드에서 OCR 처리하는 게 좋음
async function extractTextFromImage(file: File): Promise<string[]> {
  // 백엔드 API가 있으면 다음과 같이 사용
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("/v1/ocr/extract-text", {
      method: "POST",
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error(`API 오류: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.names || [];
  } catch (error) {
    console.error("OCR 실패:", error);
    throw new Error("이미지에서 텍스트를 추출할 수 없습니다");
  }
}

interface MatchResult {
  ocrText: string;
  memberId: number | null;
  memberName: string;
  confidence: number;
  alternatives: Array<{
    memberId: number;
    memberName: string;
    confidence: number;
  }>;
}

export default function ScreenshotOCR({
  members,
  onSelect,
  onClose,
}: ScreenshotOCRProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [results, setResults] = useState<MatchResult[]>([]);
  const [selectedMap, setSelectedMap] = useState<Record<string, number | null>>({});
  const [showAlternatives, setShowAlternatives] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.type.startsWith("image/")) {
      setError("이미지 파일을 선택해주세요");
      return;
    }

    // 파일 크기 제한 (5MB)
    if (selectedFile.size > 5 * 1024 * 1024) {
      setError("파일 크기가 5MB를 초과합니다");
      return;
    }

    setFile(selectedFile);
    setError("");

    // 미리보기
    const reader = new FileReader();
    reader.onload = (event) => {
      setPreview(event.target?.result as string);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length > 0) {
      const file = droppedFiles[0];
      if (file.type.startsWith("image/")) {
        if (fileInputRef.current) {
          const dt = new DataTransfer();
          dt.items.add(file);
          fileInputRef.current.files = dt.files;
          handleFileSelect({ target: fileInputRef.current } as any);
        }
      } else {
        setError("이미지 파일을 선택해주세요");
      }
    }
  };

  const handleExtractText = async () => {
    if (!file) {
      setError("파일을 선택해주세요");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const extractedNames = await extractTextFromImage(file);

      if (extractedNames.length === 0) {
        setError("이미지에서 이름을 찾을 수 없습니다");
        setResults([]);
        setLoading(false);
        return;
      }

      // 혈맹원과 매칭
      const matchResults = matchMembersWithOCR(extractedNames, members);
      setResults(matchResults);
      setSelectedMap({});
      setShowAlternatives({});

      // 자동 매칭된 것들 초기화
      const initialSelected: Record<string, number | null> = {};
      matchResults.forEach((result) => {
        initialSelected[result.ocrText] = result.memberId;
      });
      setSelectedMap(initialSelected);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "OCR 처리 중 오류가 발생했습니다"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleMemberSelect = (ocrText: string, memberId: number | null) => {
    setSelectedMap((prev) => ({
      ...prev,
      [ocrText]: memberId,
    }));
    setShowAlternatives((prev) => ({
      ...prev,
      [ocrText]: false,
    }));
  };

  const handleConfirm = () => {
    const selected = results
      .filter((r) => selectedMap[r.ocrText] !== undefined)
      .map((r) => ({
        name: r.ocrText,
        memberId: selectedMap[r.ocrText],
      }));

    onSelect(selected);
    onClose();
  };

  const matchedCount = Object.values(selectedMap).filter((id) => id !== null).length;
  const unmatchedCount = results.length - matchedCount;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex justify-between items-center p-6 border-b">
          <h2 className="text-xl font-bold">🎮 게임 스크린샷 혈맹원 감지</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* 컨텐츠 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* 단계 1: 파일 업로드 */}
          {results.length === 0 && (
            <div className="space-y-4">
              <div 
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition cursor-pointer"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div className="text-4xl mb-2">📸</div>
                <p className="text-blue-600 hover:underline font-medium">
                  이미지를 선택하세요
                </p>
                <p className="text-gray-500 text-sm mt-2">
                  또는 여기에 드래그하세요 (최대 5MB)
                </p>
              </div>

              {preview && (
                <div className="space-y-3">
                  <div className="border rounded-lg overflow-hidden bg-gray-50">
                    <img
                      src={preview}
                      alt="preview"
                      className="w-full h-auto max-h-80 object-contain"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-100"
                    >
                      다른 이미지 선택
                    </button>
                    <button
                      onClick={handleExtractText}
                      disabled={loading}
                      className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-medium"
                    >
                      {loading ? "처리 중..." : "✨ 혈맹원 감지"}
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg">
                  ⚠️ {error}
                </div>
              )}
            </div>
          )}

          {/* 단계 2: 결과 확인 및 수정 */}
          {results.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">
                  감지된 혈맹원 <span className="text-gray-500">({results.length}명)</span>
                </h3>
                <div className="text-sm">
                  <span className="text-green-600 font-medium">{matchedCount}명 매칭</span>
                  {unmatchedCount > 0 && (
                    <span className="text-yellow-600 ml-3 font-medium">{unmatchedCount}명 미분류</span>
                  )}
                </div>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {results.map((result, index) => {
                  const selectedId = selectedMap[result.ocrText];
                  const selectedMember = members.find((m) => m.id === selectedId);
                  const isMatched = selectedId !== null && selectedId !== undefined;

                  return (
                    <div
                      key={`${result.ocrText}-${index}`}
                      className={`border rounded-lg p-3 transition ${
                        isMatched
                          ? "bg-green-50 border-green-200"
                          : "bg-yellow-50 border-yellow-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">
                            {result.ocrText}
                          </div>
                          <div className="text-xs text-gray-600 mt-1">
                            신뢰도: {(result.confidence * 100).toFixed(0)}%
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          {isMatched ? (
                            <div className="bg-green-100 border border-green-300 rounded p-2">
                              <div className="text-sm font-medium text-green-900 truncate">
                                ✓ {selectedMember?.nickname || selectedMember?.loginId}
                              </div>
                              <div className="text-xs text-green-700 mt-1">
                                매칭됨
                              </div>
                            </div>
                          ) : (
                            <div className="bg-yellow-100 border border-yellow-300 rounded p-2">
                              <div className="text-sm font-medium text-yellow-900">
                                ⚠ 미분류
                              </div>
                              <div className="text-xs text-yellow-700 mt-1">
                                선택하거나 건너뛰기
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 대안 표시 */}
                      {result.alternatives.length > 0 && (
                        <button
                          onClick={() =>
                            setShowAlternatives((prev) => ({
                              ...prev,
                              [result.ocrText]: !prev[result.ocrText],
                            }))
                          }
                          className="text-blue-600 hover:underline text-sm mt-2"
                        >
                          {showAlternatives[result.ocrText]
                            ? "▼ 대안 숨기기"
                            : `▶ 대안 ${result.alternatives.length}개`}
                        </button>
                      )}

                      {showAlternatives[result.ocrText] && (
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <button
                            onClick={() => handleMemberSelect(result.ocrText, null)}
                            className={`p-2 rounded text-sm border font-medium transition ${
                              selectedId === null
                                ? "bg-gray-300 border-gray-400 text-gray-900"
                                : "bg-gray-100 border-gray-200 hover:bg-gray-200 text-gray-700"
                            }`}
                          >
                            ✕ 미분류
                          </button>
                          {result.alternatives.map((alt) => (
                            <button
                              key={alt.memberId}
                              onClick={() =>
                                handleMemberSelect(result.ocrText, alt.memberId)
                              }
                              className={`p-2 rounded text-sm border text-left transition ${
                                selectedId === alt.memberId
                                  ? "bg-blue-300 border-blue-400 font-bold text-blue-900"
                                  : "bg-gray-100 border-gray-200 hover:bg-blue-100 text-gray-700"
                              }`}
                            >
                              <div className="font-medium truncate">
                                {alt.memberName}
                              </div>
                              <div className="text-xs">
                                {(alt.confidence * 100).toFixed(0)}%
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg">
                  ⚠️ {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex justify-end gap-3 p-6 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 font-medium"
          >
            취소
          </button>
          {results.length > 0 && (
            <button
              onClick={() => {
                setResults([]);
                setPreview("");
                setFile(null);
                setError("");
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 font-medium"
            >
              다시 선택
            </button>
          )}
          {results.length > 0 && (
            <button
              onClick={handleConfirm}
              disabled={matchedCount === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-medium"
            >
              ✓ 선택 완료 ({matchedCount}명)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
