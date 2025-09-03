const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

/** path를 절대 URL로 합성 */
function joinUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const left = API_BASE.replace(/\/+$/, "");
  const right = path.startsWith("/") ? path : `/${path}`;
  return `${left}${right}`;
}

/** Authorization 헤더 구성 */
function buildAuthHeader(): Record<string, string> {
  const h: Record<string, string> = {};
  try {
    const t = localStorage?.getItem("accessToken");
    if (t) h["Authorization"] = `Bearer ${t}`;
  } catch {}
  return h;
}

/** 에러 응답 파싱 */
async function handleError(res: Response, url: string, method: string): Promise<never> {
  let bodyText = "";
  let body: any = null;
  try {
    bodyText = await res.text();
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    /* noop */
  }
  const err: any = new Error(`${res.status} ${res.statusText} @${method} ${url}`);
  err.status = res.status;
  err.body = body ?? bodyText;
  throw err;
}

/**
 * ✅ 모든 네트워크 요청을 실제로는 POST로 전송
 *  - URL 쿼리스트링은 그대로 유지(백엔드에서 @Query()로 읽기 가능)
 *  - body가 주어지면 JSON으로 전송
 *  - 디버깅용으로 X-Orig-Method 헤더에 원래 의도한 메서드를 표시
 */
export async function requestJSON<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: any,
  extraInit?: RequestInit
): Promise<T> {
  const url = joinUrl(path);

  // extraInit.headers를 객체로 정규화
  const extraHeaders = (extraInit?.headers as Record<string, string>) || {};
  const headers: Record<string, string> = {
    ...extraHeaders,
    ...buildAuthHeader(),
    Accept: "application/json",
    "X-Orig-Method": method,
  };

  // body가 있으면 JSON으로
  let fetchBody: BodyInit | undefined = extraInit?.body as BodyInit | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  // 실제 네트워크 메서드는 항상 POST
  const actualMethod: "POST" = "POST";

  const res = await fetch(url, {
    ...extraInit,         // 사용자가 넘긴 옵션을 먼저 펼치고
    method: actualMethod, // 우리가 덮어씌움
    headers,              // 최종 헤더
    body: fetchBody,      // 최종 바디
  });

  if (!res.ok) {
    await handleError(res, url, method);
  }

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  if (res.status === 204) {
    return undefined as unknown as T;
  }

  const text = await res.text();
  throw new Error(`Expected JSON but got "${ct || "unknown"}". Body(head 200ch): ${text.slice(0, 200)}`);
}

/** 헬퍼들 — 내부적으로는 전부 requestJSON()을 타서 실제 POST로 나감 */
export async function getJSON<T>(path: string, init?: RequestInit): Promise<T> {
  return requestJSON<T>("GET", path, undefined, init);
}
export async function postJSON<T>(path: string, body?: any): Promise<T> {
  return requestJSON<T>("POST", path, body);
}
export async function patchJSON<T>(path: string, body?: any): Promise<T> {
  return requestJSON<T>("PATCH", path, body);
}
export async function delJSON<T>(path: string, body?: any): Promise<T> {
  return requestJSON<T>("DELETE", path, body);
}

/** multipart/form-data 전송은 원래 POST라 그대로 */
export async function postForm<T>(path: string, form: FormData): Promise<T> {
  const url = joinUrl(path);
  const res = await fetch(url, {
    method: "POST",
    headers: buildAuthHeader(),
    body: form,
  });
  if (!res.ok) {
    await handleError(res, url, "POST");
  }
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}