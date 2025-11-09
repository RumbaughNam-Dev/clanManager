// src/screens/Feedback/FeedbackBoard.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { postJSON, getJSON, patchJSON } from "@/lib/http";
import { useAuth } from "@/contexts/AuthContext";
import Card from "../../components/common/Card";
import Pill from "../../components/common/Pill";

/** ───────── 상수/유틸 ───────── */
type FeedbackStatus = "WRITTEN" | "CONFIRMED" | "IN_PROGRESS" | "DONE" | "REJECTED";

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  WRITTEN: "작성완료",
  CONFIRMED: "확인완료",
  IN_PROGRESS: "처리중",
  DONE: "처리완료",
  REJECTED: "반려",
};

const STATUS_TONE: Record<FeedbackStatus, "default" | "warning" | "success"> = {
  WRITTEN: "default",
  CONFIRMED: "default",
  IN_PROGRESS: "warning",
  DONE: "success",
  REJECTED: "warning",
};

// 로컬 yyyy-MM-dd
function fmtYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function daysBetweenInclusive(a?: string, b?: string) {
  if (!a || !b) return Infinity;
  const ad = new Date(a + "T00:00:00");
  const bd = new Date(b + "T00:00:00");
  const s = Math.min(ad.getTime(), bd.getTime());
  const e = Math.max(ad.getTime(), bd.getTime());
  return Math.floor((e - s) / 86400000) + 1;
}
function addDaysStr(base: string, n: number) {
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return fmtYMD(dt);
}

type Row = {
  id: string;
  title: string;
  authorLoginId: string;
  status: FeedbackStatus;
  createdAt: string; // ISO
  deleted: boolean;
};

/** ───────── 상세 타입 ───────── */
type Detail = {
  ok: true;
  id: string;
  title: string;
  content: string;
  status: FeedbackStatus;
  authorLoginId: string;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  comments: Array<{
    id: string;
    authorLoginId: string;
    content: string;
    deleted: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
};

/** ───────── 메인 컴포넌트 ───────── */
export default function FeedbackBoard() {
  const { user, role } = useAuth();
  const loginId = user?.loginId ?? "";

  // 검색 폼 상태
  const [title, setTitle] = useState("");
  const [myOnly, setMyOnly] = useState(false);
  const [authorLoginId, setAuthorLoginId] = useState("");
  const today = fmtYMD(new Date());
  const weekAgo = fmtYMD(new Date(Date.now() - 7 * 86400000));
  const [fromDate, setFromDate] = useState(weekAgo);
  const [toDate, setToDate] = useState(today);

  // 목록
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [size] = useState(50);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / size));

  // 팝업 상태
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 작성/수정 팝업
  const [editOpen, setEditOpen] = useState(false);
  const [editMode, setEditMode] = useState<"create" | "edit">("create");
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  // 댓글 작성/수정
  const [commentText, setCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);

  // 되돌림용
  const prevFromRef = useRef(fromDate);
  const prevToRef = useRef(toDate);

  // 31일 제한: 입력 시 즉시 차단
  const onChangeFrom = (val: string) => {
    if (!val) return;
    if (daysBetweenInclusive(val, toDate) > 31) {
      alert("검색 기간은 최대 31일까지만 가능합니다.");
      return;
    }
    setFromDate(val);
  };
  const onChangeTo = (val: string) => {
    if (!val) return;
    if (daysBetweenInclusive(fromDate, val) > 31) {
      alert("검색 기간은 최대 31일까지만 가능합니다.");
      return;
    }
    setToDate(val);
  };

  async function loadList(p = page) {
    setLoading(true);
    try {
      const body: any = {
        title: title.trim() || undefined,
        myOnly,
        authorLoginId: myOnly ? undefined : (authorLoginId.trim() || undefined),
        fromDate,
        toDate,
        page: p,
        size,
      };
      const resp = await postJSON<{ ok: true; total: number; items: Row[] }>(
        "/v1/feedback/search",
        body
      );
      setRows(resp.items ?? []);
      setTotal(resp.total ?? 0);
      setPage(p);
      // 성공 시 유효 범위 기록
      prevFromRef.current = fromDate;
      prevToRef.current = toDate;
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("31일")) {
        alert("검색 기간은 최대 31일까지만 가능합니다.");
        // 날짜 되돌림
        setFromDate(prevFromRef.current);
        setToDate(prevToRef.current);
      }
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const data = await getJSON<Detail>(`/v1/feedback/${id}`);
      setDetail(data);
      setEditingCommentId(null);
      setCommentText("");
    } catch (e) {
      alert("상세를 불러오지 못했습니다.");
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  const canEditOrDelete = useMemo(() => {
    if (!detail) return { edit: false, del: false };
    if (detail.deleted) return { edit: false, del: false };
    if (role === "SUPERADMIN") return { edit: false, del: true }; // superadmin은 삭제만 무제한(요구사항)
    const isOwner = detail.authorLoginId === loginId;
    const started =
      detail.status === "IN_PROGRESS" ||
      detail.status === "DONE";
    return {
      edit: isOwner && !started,
      del: isOwner && !started,
    };
  }, [detail, role, loginId]);

  async function submitCreate() {
    try {
      await postJSON("/v1/feedback", {
        title: editTitle.trim(),
        content: editContent.trim(),
      });
      setEditOpen(false);
      setEditTitle(""); setEditContent("");
      await loadList(1);
    } catch (e: any) {
      alert(e?.message ?? "등록 실패");
    }
  }
  async function submitUpdate() {
    if (!editId) return;
    try {
      await patchJSON(`/v1/feedback/${editId}`, {
        title: editTitle.trim(),
        content: editContent.trim(),
      });
      setEditOpen(false);
      await loadList(page);
      if (detail?.id === editId) await openDetail(editId);
    } catch (e: any) {
      alert(e?.message ?? "수정 실패");
    }
  }

  async function softDelete(id: string) {
    if (!confirm("정말 삭제하시겠습니까? (소프트 삭제)")) return;
    try {
      await postJSON(`/v1/feedback/${id}/delete`, {});
      await loadList(page);
      if (detail?.id === id) {
        // 상세가 열려 있었다면 갱신
        await openDetail(id);
      }
    } catch (e: any) {
      alert(e?.message ?? "삭제 실패");
    }
  }

  async function changeStatus(action: "CONFIRM" | "START" | "DONE" | "REJECT") {
    if (!detail) return;
    try {
      await postJSON(`/v1/feedback/${detail.id}/status`, { action });
      await openDetail(detail.id); // 상세 재조회
      await loadList(page);        // 목록도 갱신
    } catch (e: any) {
      alert(e?.message ?? "상태 변경 실패");
    }
  }

  async function addComment() {
    if (!detail) return;
    try {
      await postJSON(`/v1/feedback/${detail.id}/comments`, {
        content: commentText.trim(),
      });
      setCommentText("");
      await openDetail(detail.id);
    } catch (e: any) {
      alert(e?.message ?? "댓글 등록 실패");
    }
  }
  async function updateComment() {
    if (!editingCommentId) return;
    try {
      await fetch(`/v1/feedback/comments/${editingCommentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: commentText.trim() }),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json())?.message ?? "댓글 수정 실패");
      });
      setEditingCommentId(null);
      setCommentText("");
      if (detail) await openDetail(detail.id);
    } catch (e: any) {
      alert(e?.message ?? "댓글 수정 실패");
    }
  }
  async function deleteComment(id: string) {
    if (!confirm("댓글을 삭제하시겠습니까? (소프트 삭제)")) return;
    try {
      await postJSON(`/v1/feedback/comments/${id}/delete`, {});
      if (detail) await openDetail(detail.id);
    } catch (e: any) {
      alert(e?.message ?? "댓글 삭제 실패");
    }
  }

  useEffect(() => {
    // 초기 로드
    loadList(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ───────── 렌더 ───────── */
  return (
    <div className="h-full flex flex-col">
      <Card className="h-full min-h-0 flex flex-col">
        {/* 검색 바 */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            className="border rounded-lg px-2 py-2 text-sm w-[220px]"
            placeholder="제목 검색"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadList(1)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={myOnly}
              onChange={(e) => setMyOnly(e.currentTarget.checked)}
            />
            내가 쓴 글만
          </label>
          <input
            className="border rounded-lg px-2 py-2 text-sm w-[180px]"
            placeholder="작성자(ID) 검색"
            value={authorLoginId}
            disabled={myOnly}
            onChange={(e) => setAuthorLoginId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadList(1)}
          />
          <div className="ml-auto flex items-center gap-2">
            <input
              type="date"
              className="border rounded-lg px-2 py-2 text-sm"
              value={fromDate}
              min={addDaysStr(toDate, -30)}
              max={toDate}
              onChange={(e) => onChangeFrom(e.currentTarget.value)}
            />
            <span>~</span>
            <input
              type="date"
              className="border rounded-lg px-2 py-2 text-sm"
              value={toDate}
              min={fromDate}
              max={addDaysStr(fromDate, 30)}
              onChange={(e) => onChangeTo(e.currentTarget.value)}
            />
            <button
              className="px-3 py-2 rounded-lg border hover:bg-slate-50 text-sm"
              onClick={() => loadList(1)}
            >
              검색
            </button>
            <button
              className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm"
              onClick={() => {
                setEditMode("create");
                setEditId(null);
                setEditTitle("");
                setEditContent("");
                setEditOpen(true);
              }}
            >
              새 글 작성
            </button>
          </div>
        </div>

        {/* 목록 */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-left text-xs text-gray-500">
                <th className="py-2">제목</th>
                <th>작성자</th>
                <th>처리여부</th>
                <th>작성일</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="py-6 text-center text-slate-500">불러오는 중…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="py-6 text-center text-slate-400 italic">등록된 건의가 없습니다.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t hover:bg-slate-50 cursor-pointer"
                    onClick={() => openDetail(r.id)}
                  >
                    <td className="py-2">
                      {r.deleted ? <span className="text-slate-400">삭제된 게시글입니다.</span> : r.title}
                    </td>
                    <td>{r.authorLoginId}</td>
                    <td>
                      <Pill tone={STATUS_TONE[r.status] as any}>{STATUS_LABEL[r.status]}</Pill>
                    </td>
                    <td>{new Date(r.createdAt).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 (간단) */}
        {totalPages > 1 && (
          <div className="mt-3 flex justify-end items-center gap-2">
            <button
              className="px-2 py-1 rounded border disabled:opacity-40"
              onClick={() => loadList(Math.max(1, page - 1))}
              disabled={page <= 1}
            >이전</button>
            <span className="text-sm text-slate-600">{page} / {totalPages}</span>
            <button
              className="px-2 py-1 rounded border disabled:opacity-40"
              onClick={() => loadList(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
            >다음</button>
          </div>
        )}
      </Card>

      {/* ───────── 작성/수정 모달 ───────── */}
      {editOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditOpen(false)} />
          <div className="relative z-[1001] w-[92vw] max-w-[560px] rounded-2xl bg-white shadow-xl border p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold">{editMode === "create" ? "새 글 작성" : "글 수정"}</h3>
              <button className="px-2 py-1 rounded hover:bg-slate-100" onClick={() => setEditOpen(false)}>×</button>
            </div>
            <input
              className="w-full border rounded-lg px-3 py-2 mb-2"
              placeholder="제목"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
            />
            <textarea
              className="w-full border rounded-lg px-3 py-2 h-40 mb-3"
              placeholder="내용"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button className="px-3 py-2 rounded-xl border hover:bg-slate-50" onClick={() => setEditOpen(false)}>취소</button>
              {editMode === "create" ? (
                <button
                  className="px-3 py-2 rounded-xl bg-slate-900 text-white"
                  onClick={submitCreate}
                >등록</button>
              ) : (
                <button
                  className="px-3 py-2 rounded-xl bg-slate-900 text-white"
                  onClick={submitUpdate}
                >수정</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ───────── 상세/댓글 모달 ───────── */}
      {detailOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDetailOpen(false)} />
          <div className="relative z-[1001] w-[96vw] max-w-[880px] rounded-2xl bg-white shadow-xl border p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold">상세 보기</h3>
              <button className="px-2 py-1 rounded hover:bg-slate-100" onClick={() => setDetailOpen(false)}>×</button>
            </div>

            {detailLoading || !detail ? (
              <div className="p-6 text-slate-500">불러오는 중…</div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="text-xl font-semibold">
                      {detail.deleted ? <span className="text-slate-400">삭제된 게시글입니다.</span> : detail.title}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      작성자: <b>{detail.authorLoginId}</b> ·{" "}
                      상태: <b>{STATUS_LABEL[detail.status]}</b> ·{" "}
                      작성일: {new Date(detail.createdAt).toLocaleString()}
                    </div>
                  </div>

                  {/* 상태변경 (superadmin) */}
                  {role === "SUPERADMIN" && !detail.deleted && (
                    <div className="flex flex-wrap gap-2 justify-end">
                      <button
                        className="px-2 py-1 rounded border hover:bg-slate-50 text-xs"
                        onClick={() => changeStatus("CONFIRM")}
                        disabled={detail.status !== "WRITTEN"}
                      >확인완료</button>
                      <button
                        className="px-2 py-1 rounded border hover:bg-slate-50 text-xs"
                        onClick={() => changeStatus("START")}
                        disabled={!(detail.status === "WRITTEN" || detail.status === "CONFIRMED")}
                      >처리중</button>
                      <button
                        className="px-2 py-1 rounded border hover:bg-slate-50 text-xs"
                        onClick={() => changeStatus("DONE")}
                        disabled={detail.status !== "IN_PROGRESS"}
                      >처리완료</button>
                      <button
                        className="px-2 py-1 rounded border hover:bg-slate-50 text-xs"
                        onClick={() => changeStatus("REJECT")}
                        disabled={!(detail.status === "WRITTEN" || detail.status === "CONFIRMED")}
                      >반려</button>
                    </div>
                  )}
                </div>

                {/* 본문 + 액션 */}
                <div className="mt-3 rounded-xl border bg-white p-3">
                  <div className="whitespace-pre-wrap text-slate-800 text-sm min-h-[64px]">
                    {detail.deleted ? "" : detail.content}
                  </div>
                  <div className="mt-3 flex gap-2 justify-end">
                    {canEditOrDelete.edit && (
                      <button
                        className="px-3 py-1.5 rounded border hover:bg-slate-50 text-sm"
                        onClick={() => {
                          setEditMode("edit");
                          setEditId(detail.id);
                          setEditTitle(detail.title);
                          setEditContent(detail.content);
                          setEditOpen(true);
                        }}
                      >수정</button>
                    )}
                    {canEditOrDelete.del && (
                      <button
                        className="px-3 py-1.5 rounded bg-red-600 text-white text-sm"
                        onClick={() => softDelete(detail.id)}
                      >삭제</button>
                    )}
                  </div>
                </div>

                {/* 댓글 */}
                <div className="mt-5">
                  <div className="mb-2 text-sm font-semibold">댓글</div>
                  {detail.comments.length === 0 ? (
                    <div className="text-sm text-slate-500 border rounded p-2">댓글이 없습니다.</div>
                  ) : (
                    <ul className="space-y-2">
                      {detail.comments.map((c) => {
                        const mine = c.authorLoginId === loginId;
                        return (
                          <li key={c.id} className="border rounded p-2">
                            <div className="flex items-center justify-between">
                              <div className="text-sm">
                                <b>{c.authorLoginId}</b>{" "}
                                <span className="text-xs text-slate-500">{new Date(c.createdAt).toLocaleString()}</span>
                              </div>
                              <div className="flex gap-2">
                                {/* 수정/삭제: 본인 & 처리전, 또는 superadmin */}
                                {role === "SUPERADMIN" || mine ? (
                                  <>
                                    <button
                                      className="px-2 py-1 rounded border hover:bg-slate-50 text-xs"
                                      onClick={() => {
                                        setEditingCommentId(c.id);
                                        setCommentText(c.deleted ? "" : c.content);
                                      }}
                                    >수정</button>
                                    <button
                                      className="px-2 py-1 rounded bg-red-600 text-white text-xs"
                                      onClick={() => deleteComment(c.id)}
                                    >삭제</button>
                                  </>
                                ) : null}
                              </div>
                            </div>
                            <div className="mt-1 text-sm whitespace-pre-wrap">
                              {c.deleted ? <span className="text-slate-400">삭제된 댓글입니다.</span> : c.content}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* 댓글 작성/수정 입력 */}
                  {!detail.deleted && (
                    <div className="mt-3 flex items-start gap-2">
                      <textarea
                        className="flex-1 border rounded-lg px-2 py-2 h-[72px] text-sm"
                        placeholder={editingCommentId ? "댓글 수정…" : "댓글을 입력하세요…"}
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                      />
                      {editingCommentId ? (
                        <div className="flex flex-col gap-2">
                          <button
                            className="px-3 py-2 rounded bg-slate-900 text-white text-sm"
                            onClick={updateComment}
                          >수정</button>
                          <button
                            className="px-3 py-2 rounded border text-sm"
                            onClick={() => { setEditingCommentId(null); setCommentText(""); }}
                          >취소</button>
                        </div>
                      ) : (
                        <button
                          className="px-3 py-2 rounded bg-slate-900 text-white text-sm"
                          onClick={addComment}
                        >등록</button>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}