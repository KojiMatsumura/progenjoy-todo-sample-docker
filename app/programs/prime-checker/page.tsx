"use client";

import { useCallback, useState } from "react";
import styles from "./assets/prime-checker.module.css";
import { buildPrimeWorkerCode } from "./lib/buildPrimeWorkerCode";
import { parsePrimeInput } from "./lib/parsePrimeInput";
import { useUserLogicBridge } from "./lib/useUserLogicBridge";

function PrimeResultView({ result }: { result: unknown }) {
  if (result == null || typeof result !== "object") {
    return <div className={styles.result}>{String(result)}</div>;
  }
  const r = result as Record<string, unknown>;
  if (r.ok === false) {
    return (
      <div className={styles.result}>
        {String(r.message ?? "判定できませんでした")}
      </div>
    );
  }
  if (r.prime === true && typeof r.n === "number") {
    return (
      <div className={styles.resultPrimeYes}>
        <strong>{r.n}</strong> は<strong>素数</strong>です。
      </div>
    );
  }
  if (r.prime === false && typeof r.n === "number") {
    return (
      <div className={styles.resultPrimeNo}>
        <strong>{r.n}</strong> は素数ではありません。
        {typeof r.factor === "number" ? (
          <>
            {" "}
            <code className={styles.codeInline}>{r.factor}</code>{" "}
            で割り切れます。
          </>
        ) : r.reason != null ? (
          <> {String(r.reason)}</>
        ) : null}
      </div>
    );
  }
  return <div className={styles.result}>{JSON.stringify(result)}</div>;
}

export default function PrimeCheckerPage() {
  const { runCode, hasParent } = useUserLogicBridge();
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [statusError, setStatusError] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [showResult, setShowResult] = useState(false);
  const [busy, setBusy] = useState(false);

  const setStatusLine = useCallback((msg: string, isError?: boolean) => {
    setStatus(msg);
    setStatusError(!!isError);
  }, []);

  const onCheck = useCallback(async () => {
    setShowResult(false);
    setResult(null);
    const parsed = parsePrimeInput(input);
    if ("error" in parsed) {
      setStatusLine(parsed.error, true);
      return;
    }
    if (!hasParent()) {
      setStatusLine(
        "親フレームなし（ランナーの iframe 内で開いてください）",
        true
      );
      return;
    }
    setStatusLine("親で計算中（api_id:3）…");
    setBusy(true);
    try {
      const code = buildPrimeWorkerCode(parsed.n);
      const res = await runCode(code);
      setStatusLine("完了（api_id:3 の結果を表示）");
      setResult(res);
      setShowResult(true);
    } catch (e) {
      setStatusLine(e instanceof Error ? e.message : String(e), true);
      setShowResult(false);
    } finally {
      setBusy(false);
    }
  }, [hasParent, input, runCode, setStatusLine]);

  return (
    <div className={styles.app}>
      <h1 className={styles.pageTitle}>素数判定</h1>
      <p className={styles.sub}>
        判定ロジックは親のワーカーで実行されます（<code>api_id: 3</code> /
        <code> content.code</code>）。
      </p>

      <div>
        <label className={styles.label} htmlFor="n-input">
          判定する整数（0 以上）
        </label>
        <div className={styles.field}>
          <input
            id="n-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="例: 17"
            maxLength={20}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onCheck();
            }}
          />
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={busy}
            onClick={() => void onCheck()}
          >
            判定
          </button>
        </div>
      </div>

      <p
        className={statusError ? styles.statusError : styles.status}
        aria-live="polite"
      >
        {status}
      </p>

      {showResult && result !== null ? <PrimeResultView result={result} /> : null}
    </div>
  );
}
