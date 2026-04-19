import type { Metadata } from "next";
import "./assets/prime-checker-globals.css";
import styles from "./assets/prime-checker.module.css";

export const metadata: Metadata = {
  title: "素数判定",
  description: "postMessage（api_id:3）で親ワーカーに素数判定を依頼します",
};

export default function PrimeCheckerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={styles.root}>{children}</div>;
}
