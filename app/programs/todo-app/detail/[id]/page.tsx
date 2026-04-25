"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../../assets/todo-app.module.css";
import dependencies from "../../assets/dependencies-detail.json";
import { loadLibrariesFromManifest } from "@/lib/programDependencyLoader";
import { useTodoBridge } from "../../lib/useTodoBridge";
import {
  buildContentForSave,
  formatDateLong,
  normalizeItemsFromRoot,
  type TodoItem,
} from "../../lib/todoModel";

export default function TodoDetailPage() {
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
  const params = useParams();
  const router = useRouter();
  const rawId = params?.id;
  const id = typeof rawId === "string" ? decodeURIComponent(rawId) : "";

  const { requestRead, requestSave, hasParent } = useTodoBridge();
  const [lastContent, setLastContent] = useState<Record<string, unknown>>({});
  const lastContentRef = useRef<Record<string, unknown>>({});
  const [item, setItem] = useState<TodoItem | null>(null);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState("");
  const [statusError, setStatusError] = useState(false);
  const [notFound, setNotFound] = useState(false);
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
            "luxon の初期化に失敗しました（dependencies-detail.json の定義と CDN 配信物を確認してください）"
          );
        }
        if (!cancelled) {
          setDateTime(() => dt);
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
  }, [setStatusLine]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!id) {
        setNotFound(true);
        setStatusLine("id がありません", true);
        return;
      }
      if (!hasParent()) {
        setNotFound(true);
        setStatusLine("読込にはランナー（/）の iframe 内で開いてください", true);
        return;
      }
      setStatusLine("読込中…");
      try {
        const data = await requestRead();
        if (cancelled) return;
        const root =
          data && typeof data.content === "object" && data.content !== null
            ? data.content
            : {};
        lastContentRef.current = root;
        setLastContent(root);
        let norm = normalizeItemsFromRoot(root);
        setItem(null);
        setNotFound(false);

        if (norm.migrationNeeded && hasParent()) {
          const content = buildContentForSave(root, norm.items);
          const d2 = await requestSave(content);
          if (cancelled) return;
          const root2 =
            d2 && typeof d2.content === "object" && d2.content !== null
              ? d2.content
              : {};
          lastContentRef.current = root2;
          setLastContent(root2);
          norm = normalizeItemsFromRoot(root2);
        }

        const found = norm.items.find((x) => x.id === id);
        if (!found) {
          setNotFound(true);
          setStatusLine("");
          return;
        }
        setItem(found);
        setDone(found.done);
        setStatusLine("");
      } catch (e) {
        if (!cancelled) {
          setStatusLine(e instanceof Error ? e.message : String(e), true);
          setNotFound(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 初回・id 変更時のみ読込
  }, [id]);

  const persistItems = useCallback(
    async (nextItems: TodoItem[]) => {
      if (!hasParent()) return;
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
        setStatusLine("保存しました");
      } catch (e) {
        setStatusLine(e instanceof Error ? e.message : String(e), true);
      }
    },
    [hasParent, requestSave, setStatusLine]
  );

  const onDoneChange = useCallback(
    (checked: boolean) => {
      setDone(checked);
      if (!id) return;
      const norm = normalizeItemsFromRoot(lastContentRef.current);
      const next = norm.items.map((x) =>
        x.id === id ? { ...x, done: checked } : x
      );
      const found = next.find((x) => x.id === id);
      if (found) setItem(found);
      void persistItems(next);
    },
    [id, persistItems]
  );

  const onDelete = useCallback(async () => {
    if (!id) return;
    if (!hasParent()) return;
    setStatusLine("保存中…");
    try {
      const norm = normalizeItemsFromRoot(lastContentRef.current);
      const next = norm.items.filter((x) => x.id !== id);
      const content = buildContentForSave(lastContentRef.current, next);
      await requestSave(content);
      router.push("/programs/todo-app/");
    } catch (e) {
      setStatusLine(e instanceof Error ? e.message : String(e), true);
    }
  }, [hasParent, id, requestSave, router, setStatusLine]);

  const dueText = useCallback(
    (dueAt?: string) => {
      if (!dueAt) return "未設定";
      if (!DateTime) return dueAt + "（luxon 読込待ち）";
      const due = DateTime.fromISO(dueAt, { zone: "local" });
      if (!due.isValid) return dueAt + "（日付形式エラー）";
      return due.toLocaleString(DateTime.DATE_SHORT);
    },
    [DateTime]
  );

  const remainText = useCallback(
    (dueAt?: string) => {
      if (!dueAt) return "—";
      if (!DateTime) return "luxon 読込待ち";
      const due = DateTime.fromISO(dueAt, { zone: "local" });
      if (!due.isValid) return "日付形式エラー";
      const today = DateTime.now().startOf("day");
      const days = Math.ceil(due.startOf("day").diff(today, "days").days);
      if (days > 0) return "残り" + String(days) + "日";
      if (days === 0) return "今日まで";
      return String(Math.abs(days)) + "日超過";
    },
    [DateTime]
  );

  return (
    <div className={styles.app}>
      <p className={styles.backRow}>
        <Link className={styles.backLink} href="/programs/todo-app/">
          ← 一覧へ戻る
        </Link>
      </p>
      <h1 className={`${styles.pageTitle} ${styles.detailPageTitle}`}>TODO 詳細</h1>

      <p
        className={statusError ? styles.statusError : styles.status}
        aria-live="polite"
      >
        {status}
      </p>

      {notFound ? (
        <div className={styles.notFound}>
          <p>該当する TODO が見つかりません。</p>
          <p>
            <Link href="/programs/todo-app/">一覧へ</Link>
          </p>
        </div>
      ) : item ? (
        <div className={styles.detailCard}>
          <h2 className={styles.detailHeading}>{item.title || "（無題）"}</h2>
          <dl className={styles.detailDl}>
            <dt>作成日時</dt>
            <dd>{formatDateLong(item.createdAt)}</dd>
            <dt>ID</dt>
            <dd>
              <code className={styles.detailIdCode}>{item.id}</code>
            </dd>
            <dt>状態</dt>
            <dd>
              <label className={styles.doneLabel}>
                <input
                  type="checkbox"
                  checked={done}
                  onChange={(e) => onDoneChange(e.target.checked)}
                />
                完了
              </label>
            </dd>
            <dt>期限日</dt>
            <dd>{dueText(item.dueAt)}</dd>
            <dt>残り日数</dt>
            <dd>{remainText(item.dueAt)}</dd>
          </dl>
          <div className={styles.detailActions}>
            <button
              type="button"
              className={styles.btnDanger}
              onClick={() => void onDelete()}
            >
              削除
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
