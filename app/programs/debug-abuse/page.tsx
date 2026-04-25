"use client";

import { useCallback, useState } from "react";
import styles from "./assets/debug-abuse.module.css";
import { OVERSIZED_APPROX_BYTES } from "./lib/constants";

function hasParentFrame(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

export default function DebugAbusePage() {
  const [spamCount, setSpamCount] = useState(200);
  const [spamLog, setSpamLog] = useState("");
  const [bigLog, setBigLog] = useState("");
  const [loopLog, setLoopLog] = useState("");
  /** sandbox 既定では `confirm` が使えないため、同じボタンを二度押す二段階にする */
  const [infiniteLoopArmed, setInfiniteLoopArmed] = useState(false);

  const redirectRoot = useCallback(() => {
    window.location.assign("/");
  }, []);

  const redirectApi = useCallback(() => {
    window.location.assign("/api/child-programs");
  }, []);

  const redirectSibling = useCallback(() => {
    window.location.assign("/programs/todo-app/");
  }, []);

  const redirectExternal = useCallback(() => {
    window.location.assign("https://example.com/");
  }, []);

  const runSpam = useCallback(() => {
    if (!hasParentFrame()) {
      setSpamLog("親フレームなし（iframe 内で開いてください）");
      return;
    }
    let n = spamCount;
    if (!Number.isFinite(n) || n < 1) n = 200;
    if (n > 10000) n = 10000;
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    let i: number;
    for (i = 0; i < n; i++) {
      window.parent.postMessage(
        {
          debugAbuse: true,
          kind: "spam",
          seq: i,
          total: n,
        },
        "*"
      );
    }
    const t1 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    setSpamLog(
      "送信完了: " + n + " 回（約 " + (t1 - t0).toFixed(1) + " ms）"
    );
  }, [spamCount]);

  const sendOversized = useCallback(() => {
    if (!hasParentFrame()) {
      setBigLog("親フレームなし（iframe 内で開いてください）");
      return;
    }
    const payload = new Array(OVERSIZED_APPROX_BYTES + 1).join("x");
    window.parent.postMessage(
      {
        debugAbuse: true,
        kind: "oversized",
        approxBytes: OVERSIZED_APPROX_BYTES,
        payload,
      },
      "*"
    );
  }, []);

  const cancelInfiniteLoopArm = useCallback(() => {
    setInfiniteLoopArmed(false);
    setLoopLog("");
  }, []);

  const runInfiniteLoop = useCallback(() => {
    if (!infiniteLoopArmed) {
      setInfiniteLoopArmed(true);
      setLoopLog(
        "確認: もう一度「無限ループを実行」を押すと、この iframe 内で for (;;) による無限ループが走ります（画面はフリーズします）。取り消す場合は下の「取り消し」を押してください。"
      );
      return;
    }
    setLoopLog("無限ループを開始します…（直後にこの画面はフリーズします）");
    window.setTimeout(() => {
      for (;;) {
        /* 検証用: メインスレッド占有 */
      }
    }, 100);
  }, [infiniteLoopArmed]);

  return (
    <div className={styles.app}>
      <h1 className={styles.pageTitle}>不正行為テスト</h1>
      <p className={styles.warn}>
        禁止されている行為をお伝えするためにこのプログラムを作っています。以下のようなことをするプログラムをアップロードするとアカウント停止になる場合があるため、本番では決して使用しないでください。
      </p>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>リダイレクト</h2>
        <p className={styles.desc}>
          子アプリの URL 範囲（
          <code className={styles.inlineCode}>/programs/debug-abuse/…</code>
          ）外へ遷移します。
        </p>
        <button type="button" className={styles.btn} onClick={redirectRoot}>
          ランナー外（サイトルート <code className={styles.inlineCode}>/</code>{" "}
          へ）
        </button>
        <button type="button" className={styles.btn} onClick={redirectApi}>
          API パス（
          <code className={styles.inlineCode}>/api/child-programs</code> へ）
        </button>
        <button type="button" className={styles.btn} onClick={redirectSibling}>
          別 program（
          <code className={styles.inlineCode}>/programs/todo-app/</code> へ）
        </button>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>外部サイトへリダイレクト</h2>
        <p className={styles.desc}>
          同一オリジン外へ遷移します（例: example.com）。
        </p>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          onClick={redirectExternal}
        >
          <code className={styles.inlineCode}>https://example.com</code> へ
        </button>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>postMessage 連打</h2>
        <p className={styles.desc}>
          短時間に多数の <code className={styles.inlineCode}>postMessage</code>{" "}
          を送ります。
        </p>
        <label className={styles.inline}>
          回数
          <input
            type="number"
            value={spamCount}
            min={1}
            max={10000}
            onChange={(e) => setSpamCount(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          onClick={runSpam}
        >
          連打実行
        </button>
        <p className={styles.log} aria-live="polite">
          {spamLog}
        </p>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>大きすぎる postMessage</h2>
        <p className={styles.desc}>
          約 100KB の文字列を含むオブジェクトを 1
          回送信します。
        </p>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          onClick={sendOversized}
        >
          約 100KB を 1 回送信
        </button>
        <p className={styles.log} aria-live="polite">
          {bigLog}
        </p>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>無限ループ</h2>
        <p className={styles.desc}>
          サイトを重くする無限ループ
          を実行します。2 回押して確定します。
        </p>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          onClick={runInfiniteLoop}
        >
          {infiniteLoopArmed
            ? "無限ループを実行（確定）"
            : "無限ループを実行"}
        </button>
        {infiniteLoopArmed && (
          <button
            type="button"
            className={styles.btn}
            onClick={cancelInfiniteLoopArm}
          >
            取り消し
          </button>
        )}
        <p className={styles.log} aria-live="polite">
          {loopLog}
        </p>
      </section>
    </div>
  );
}
