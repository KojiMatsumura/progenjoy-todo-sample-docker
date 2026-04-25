import type { Metadata } from "next";
import "./assets/csp-sandbox-lab-globals.css";
import styles from "./assets/csp-sandbox-lab.module.css";

export const metadata: Metadata = {
  title: "CSP / sandbox 制限デモ",
  description:
    "子プログラムの CSP と親 iframe の sandbox でブロックされる操作の試行一覧",
};

export default function CspSandboxLabLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={styles.root}>{children}</div>;
}
