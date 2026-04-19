import type { Metadata } from "next";
import "./assets/todo-app-globals.css";
import styles from "./assets/todo-app.module.css";

export const metadata: Metadata = {
  title: "TODO リスト",
  description: "postMessage（api_id:1/2）で永続化する TODO",
};

export default function TodoAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={styles.root}>{children}</div>;
}
