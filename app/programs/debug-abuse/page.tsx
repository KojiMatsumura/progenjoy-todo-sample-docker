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

  const redirectRoot = useCallback(() => {
    window.location.assign("/");
  }, []);

  const redirectApi = useCallback(() => {
    window.location.assign("/api/child-programs");
  }, []);

  const redirectSibling = useCallback(() => {
    window.location.assign("/programs/default/");
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
    setBigLog(
      "送信: kind=oversized, 文字列長約 " +
        OVERSIZED_APPROX_BYTES +
        " バイト（UTF-16 環境ではメモリ上はそれ以上になる場合あり）"
    );
  }, []);

  return (
    <div className={styles.app}>
      <h1 className={styles.pageTitle}>デバッグ：不正行為テスト</h1>
      <p className={styles.warn}>
        開発・検証用です。本番では使用しないでください。
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
          <code className={styles.inlineCode}>/programs/default/</code> へ）
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
          を親へ送ります（既定 200 回）。
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
          回送信します（親のログ・処理負荷確認用）。
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
    </div>
  );
}
