## OCR 스크린샷 기능 - 백엔드 API 구현 가이드

### 개요

프론트엔드에서 게임 스크린샷을 업로드하고, 백엔드에서 OCR 처리하여 혈맹원 이름을 감지하는 기능입니다.

### 필수 구현 사항

#### 1. POST `/v1/ocr/extract-text` 엔드포인트

**요청:**

- `multipart/form-data`
- 필드: `file` (이미지 파일)

**응답:**

```json
{
  "names": ["캐릭터이름1", "캐릭터이름2", "캐릭터이름3"]
}
```

**구현 요구사항:**

1. 이미지 파일 받기 (JPG, PNG, GIF 등)
2. OCR 라이브러리를 사용하여 텍스트 추출
   - 추천: Tesseract.js (Node.js 버전), Pytesseract (Python), EasyOCR 등
3. 추출된 텍스트에서 라인 단위로 분리
4. 각 라인을 개별 이름으로 처리
5. 빈 줄 제거 및 공백 정규화
6. JSON 응답으로 반환

**권장 라이브러리:**

- Node.js: `tesseract.js`, `sharp` (이미지 전처리)
- Python: `pytesseract`, `opencv-python`, `PIL`
- 클라우드: Google Cloud Vision API, AWS Rekognition, Azure Computer Vision

**예시 (Node.js):**

```javascript
const Tesseract = require("tesseract.js");
const express = require("express");

app.post("/v1/ocr/extract-text", async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file provided" });

    const result = await Tesseract.recognize(file.path, "kor+eng");
    const text = result.data.text;

    // 라인 단위로 분리
    const names = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.length < 50);

    res.json({ names });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### 프론트엔드 동작 플로우

1. **스크린샷 선택**
   - 사용자가 "📸 스크린샷 OCR" 버튼 클릭
   - 이미지 파일 선택 (또는 드래그)
   - 미리보기 표시

2. **OCR 처리**
   - 이미지 업로드
   - `/v1/ocr/extract-text` 호출
   - 추출된 이름 목록 수신

3. **혈맹원 자동 매칭**
   - 추출된 각 이름을 혈맹원 리스트와 비교
   - `calculateSimilarity()` 함수로 유사도 계산 (0~1)
   - 신뢰도 >= 60%인 경우만 자동 매칭
   - 대안 목록 제시 (신뢰도가 낮을 경우)

4. **사용자 확인 및 수정**
   - 각 추출 이름별로:
     - 자동 매칭된 혈맹원 표시
     - 신뢰도 표시
     - 대안 선택 가능
     - 미분류 옵션 (혈원 리스트에 없는 경우)
   - 사용자가 수정/확인

5. **드래프트에 추가**
   - 선택된 혈맹원들이 드래프트 행으로 추가됨
   - 루팅자 필드에 자동 채워짐
   - 아이템명 수동 입력 필요

### 프론트엔드 코드 위치

- **OCR 유틸**: `src/utils/ocrUtils.ts`
  - `calculateSimilarity()`: 유사도 계산
  - `matchMembersWithOCR()`: 혈맹원 매칭 로직
  - `normalizeOCRText()`: 텍스트 정규화

- **OCR 모달**: `src/components/modals/ScreenshotOCR.tsx`
  - 파일 업로드 UI
  - 결과 표시 및 선택 UI
  - `handleExtractText()`: API 호출

- **통합**: `src/screens/RaidManage/RaidManage.tsx`
  - OCR 버튼 추가
  - `handleOCRSelect()`: 선택 결과 처리

### 테스트 방법

1. 리니지 게임 스크린샷 준비 (혈맹원 이름 포함)
2. "📸 스크린샷 OCR" 버튼 클릭
3. 스크린샷 업로드
4. 감지된 이름 확인
5. 혈맹원 선택 후 "선택 완료"
6. 드래프트에 루팅자가 추가되는지 확인

### 주의사항

1. **보안**: 파일 크기 제한, 바이러스 스캔 필요
2. **성능**: OCR 처리는 시간이 걸리므로 타임아웃 설정 필요
3. **신뢰도**: 게임 폰트/품질에 따라 OCR 정확도 달라짐
4. **에러 처리**: 파일 없음, 형식 오류, OCR 실패 등 처리 필요

### 옵션: 이미지 전처리

백엔드에서 OCR 정확도 향상을 위해 이미지 전처리 추천:

```python
import cv2
import pytesseract

def preprocess_image(image_path):
    # 이미지 로드
    img = cv2.imread(image_path)

    # 그레이스케일 변환
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 대비 향상
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    enhanced = clahe.apply(gray)

    # 이진화
    _, binary = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # 노이즈 제거
    denoised = cv2.medianBlur(binary, 3)

    return denoised

# OCR 처리
preprocessed = preprocess_image('screenshot.jpg')
text = pytesseract.image_to_string(preprocessed, lang='kor+eng')
```

### 향후 개선사항

1. **캐싱**: 동일한 스크린샷 재처리 방지
2. **배치 처리**: 여러 파일 동시 처리
3. **커스텀 학습**: 게임 폰트 전용 OCR 모델 학습
4. **대체 방식**: 수동 입력 + 자동완성 강화
5. **클라우드 API**: 고정확도 요구시 Google Vision, AWS 사용
