"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./assets/todo-app.module.css";
import dependencies from "./assets/dependencies.json";
import { loadLibrariesFromManifest } from "@/lib/programDependencyLoader";
import { useTodoBridge } from "./lib/useTodoBridge";
import {
  buildContentForSave,
  formatDateShort,
  genTodoId,
  normalizeItemsFromRoot,
  type TodoItem,
} from "./lib/todoModel";

export default function TodoListPage() {
  type LuxonDateTime = {
    now: () => { startOf: (unit: string) => any };
    fromISO: (
      iso: string,
      opts?: { zone?: string }
    ) => {
      isValid: boolean;
      toLocaleString: (fmt: unknown) => string;
      startOf: (unit: string) => any;
      diff: (other: any, unit: string) => { days: number };
    };
    DATE_SHORT: unknown;
  };
  const { requestRead, requestSave, hasParent } = useTodoBridge();
  const [items, setItems] = useState<TodoItem[]>([]);
  const [lastContent, setLastContent] = useState<Record<string, unknown>>({});
  const lastContentRef = useRef<Record<string, unknown>>({});
  const [status, setStatus] = useState("");
  const [statusError, setStatusError] = useState(false);
  const [DateTime, setDateTime] = useState<LuxonDateTime | null>(null);

  useEffect(() => {
    lastContentRef.current = lastContent;
  }, [lastContent]);

  const setStatusLine = useCallback((msg: string, isError?: boolean) => {
    setStatus(msg);
    setStatusError(!!isError);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadLibrariesFromManifest(dependencies);
        const dt = (window as unknown as { luxon?: { DateTime?: LuxonDateTime } })
          .luxon?.DateTime;
        if (!dt) {
          throw new Error(
            "luxon の初期化に失敗しました（dependencies.json の定義と CDN 配信物を確認してください）"
          );
        }
        if (!cancelled) {
          setDateTime(() => dt);
        }
      } catch (e) {
        if (!cancelled) {
          setStatusLine(
            e instanceof Error ? e.message : String(e),
            true
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setStatusLine]);

  const persist = useCallback(
    async (nextItems: TodoItem[]) => {
      if (!hasParent()) {
        setStatusLine("保存できません（親なし）", true);
        return;
      }
      setStatusLine("保存中…");
      try {
        const content = buildContentForSave(lastContentRef.current, nextItems);
        const data = await requestSave(content);
        const root =
          data && typeof data.content === "object" && data.content !== null
            ? data.content
            : {};
        lastContentRef.current = root;
        setLastContent(root);
        const norm = normalizeItemsFromRoot(root);
        setItems(norm.items);
        setStatusLine("保存しました");
      } catch (e) {
        setStatusLine(e instanceof Error ? e.message : String(e), true);
      }
    },
    [hasParent, requestSave, setStatusLine]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!hasParent()) {
        setStatusLine("読込にはランナー（/）の iframe 内で開いてください", true);
        return;
      }
      setStatusLine("読込中…");
      try {
        const data = await requestRead();
        const root =
          data && typeof data.content === "object" && data.content !== null
            ? data.content
            : {};
        if (cancelled) return;
        lastContentRef.current = root;
        setLastContent(root);
        const norm = normalizeItemsFromRoot(root);
        setItems(norm.items);
        if (norm.migrationNeeded && hasParent()) {
          setStatusLine("データを補正して保存しています…");
          const content = buildContentForSave(root, norm.items);
          const d2 = await requestSave(content);
          if (cancelled) return;
          const root2 =
            d2 && typeof d2.content === "object" && d2.content !== null
              ? d2.content
              : {};
          lastContentRef.current = root2;
          setLastContent(root2);
          const norm2 = normalizeItemsFromRoot(root2);
          setItems(norm2.items);
          setStatusLine("読込完了（データを更新しました）");
        } else {
          setStatusLine("読込完了（api_id:1）");
        }
      } catch (e) {
        if (!cancelled) {
          setStatusLine(e instanceof Error ? e.message : String(e), true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasParent, requestRead, requestSave, setStatusLine]);

  const reload = useCallback(async () => {
    if (!hasParent()) {
      setStatusLine("読込にはランナー（/）の iframe 内で開いてください", true);
      return;
    }
    setStatusLine("読込中…");
    try {
      const data = await requestRead();
      const root =
        data && typeof data.content === "object" && data.content !== null
          ? data.content
          : {};
      lastContentRef.current = root;
      setLastContent(root);
      const norm = normalizeItemsFromRoot(root);
      setItems(norm.items);
      if (norm.migrationNeeded && hasParent()) {
        setStatusLine("データを補正して保存しています…");
        const content = buildContentForSave(root, norm.items);
        const d2 = await requestSave(content);
        const root2 =
          d2 && typeof d2.content === "object" && d2.content !== null
            ? d2.content
            : {};
        lastContentRef.current = root2;
        setLastContent(root2);
        const norm2 = normalizeItemsFromRoot(root2);
        setItems(norm2.items);
        setStatusLine("読込完了（データを更新しました）");
      } else {
        setStatusLine("読込完了（api_id:1）");
      }
    } catch (e) {
      setStatusLine(e instanceof Error ? e.message : String(e), true);
    }
  }, [hasParent, requestRead, requestSave, setStatusLine]);

  const onToggleDone = useCallback(
    (id: string, done: boolean) => {
      setItems((prev) => {
        const next = prev.map((x) =>
          x.id === id ? { ...x, done } : x
        );
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  const onDelete = useCallback(
    (id: string) => {
      setItems((prev) => {
        const next = prev.filter((x) => x.id !== id);
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  const onAdd = useCallback(
    (title: string, dueAt: string) => {
      const t = title.trim();
      if (!t) {
        setStatusLine("タイトルを入力してください", true);
        return;
      }
      setItems((prev) => {
        const next = [
          ...prev,
          {
            id: genTodoId(),
            title: t,
            done: false,
            createdAt: new Date().toISOString(),
            dueAt: dueAt || undefined,
          },
        ];
        void persist(next);
        return next;
      });
    },
    [persist, setStatusLine]
  );

  const [newTitle, setNewTitle] = useState("");
  const [newDueAt, setNewDueAt] = useState("");

  const formatDueMeta = useCallback(
    (dueAt?: string) => {
      if (!dueAt) return "期限: 未設定";
      if (!DateTime) return "期限: " + dueAt + "（luxon 読込待ち）";
      const due = DateTime.fromISO(dueAt, { zone: "local" });
      if (!due.isValid) return "期限: " + dueAt + "（日付形式エラー）";
      const today = DateTime.now().startOf("day");
      const days = Math.ceil(due.startOf("day").diff(today, "days").days);
      const remain =
        days > 0
          ? "残り" + String(days) + "日"
          : days === 0
            ? "今日まで"
            : String(Math.abs(days)) + "日超過";
      return "期限: " + due.toLocaleString(DateTime.DATE_SHORT) + " ・ " + remain;
    },
    [DateTime]
  );

  return (
    <div className={styles.app}>
      <h1 className={styles.pageTitle}>TODO リスト</h1>
      <p className={styles.sub}>
        読込: <code>api_id: 1</code> ／ 保存: <code>api_id: 2</code>
      </p>

      <div className={styles.toolbar}>
        <input
          type="text"
          placeholder="新しい TODO"
          maxLength={500}
          autoComplete="off"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
                  onAdd(newTitle, newDueAt);
              setNewTitle("");
            }
          }}
        />
        <input
          type="date"
          value={newDueAt}
          onChange={(e) => setNewDueAt(e.target.value)}
        />
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={() => {
            onAdd(newTitle, newDueAt);
            setNewTitle("");
          }}
        >
          追加
        </button>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={() => void reload()}
        >
          再読込
        </button>
      </div>

      <p
        className={statusError ? styles.statusError : styles.status}
        aria-live="polite"
      >
        {status}
      </p>

      <div>
        {items.length === 0 ? (
          <div className={styles.empty}>
            TODO はまだありません。追加するか、読込してください。
          </div>
        ) : (
          <ul className={styles.todoList}>
            {items.map((it) => (
              <li
                key={it.id}
                className={`${styles.todoRow} ${it.done ? styles.todoRowDone : ""}`}
              >
                <input
                  type="checkbox"
                  className={styles.todoCb}
                  checked={it.done}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleDone(it.id, e.target.checked);
                  }}
                  aria-label="完了にする"
                />
                <div className={styles.todoMain}>
                  <Link
                    className={styles.detailLink}
                    href={`/programs/todo-app/detail/${encodeURIComponent(it.id)}`}
                  >
                    <span className={styles.titleText}>
                      {it.title || "（無題）"}
                    </span>
                    <div className={styles.meta}>
                      作成: {formatDateShort(it.createdAt)} ・ ID:{" "}
                      {it.id.slice(0, 8)}…
                    </div>
                    <div className={styles.meta}>{formatDueMeta(it.dueAt)}</div>
                  </Link>
                </div>
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete(it.id);
                  }}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
