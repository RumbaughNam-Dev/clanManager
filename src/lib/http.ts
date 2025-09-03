// src/lib/http.ts
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

function joinUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const left = API_BASE.replace(/\/+$/, "");
  const right = path.startsWith("/") ? path : `/${path}`;
  return `${left}${right}`;
}

function buildAuthHeader(): Record<string, string> {
  const h: Record<string, string> = {};
  try {
    const t = localStorage?.getItem("accessToken");
    if (t) h["Authorization"] = `Bearer ${t}`;
  } catch {}
  return h;
}

async function handleError(res: Response, url: string, method: string): Promise<never> {
  let bodyText = "";
  let body: any = null;
  try {
    bodyText = await res.text();
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    // ignore parse error
  }
  const err: any = new Error(`${res.status} ${res.statusText} @${method} ${url}`);
  err.status = res.status;
  err.body = body ?? bodyText;
  throw err;
}

/**
 * ✅ 모든 요청을 실제로는 POST로 보냄
 * - URL의 쿼리스트링은 그대로 유지 (백엔드 @Post 핸들러에서 @Query()로 읽기 가능)
 * - 바디가 있으면 JSON으로 전송
 * - 헤더에 X-Orig-Method 넣어 디버깅 도움(백엔드에서 안 써도 무방)
 */
export async function requestJSON<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: any,
  extraInit?: RequestInit
): Promise<T> {
  const url = joinUrl(path);
  const headers: Record<string, string> = {
    ...buildAuthHeader(),
    ...(extraInit?.headers as Record<string, string> | undefined),
    Accept: "application/json",
    "X-Orig-Method": method, // 디버깅용
  };

  let fetchBody: BodyInit | undefined = extraInit?.body as BodyInit | undefined;

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  // ⬇️ 여기서 실제 메서드는 무조건 POST로 변환
  const actualMethod = "POST";

  const res = await fetch(url, {
    method: actualMethod,
    headers,
    body: fetchBody,
    ...extraInit,
  });

  if (!res.ok) {
    await handleError(res, url, method);
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.toLowerCase().includes("application/json")) {
    return res.json() as Promise<T>;
  }
  if (res.status === 204) {
    return undefined as unknown as T;
  }

  const text = await res.text();
  throw new Error(
    `Expected JSON but got "${ct || "unknown"}". Body(head 200ch): ${text.slice(0, 200)}`
  );
}

// 헬퍼들은 그대로 두되, 내부적으로는 위에서 모두 POST로 전송됨
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