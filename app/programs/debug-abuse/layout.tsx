import type { Metadata } from "next";
import "./assets/debug-abuse-globals.css";
import styles from "./assets/debug-abuse.module.css";

export const metadata: Metadata = {
  title: "デバッグ：不正行為テスト",
  description: "iframe 検証用（リダイレクト・postMessage 負荷など）",
};

export default function DebugAbuseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={styles.root}>{children}</div>;
}
