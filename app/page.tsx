import { Suspense } from "react";
import { ProgramRunner } from "@/components/ProgramRunner";

function LoadingMain() {
  return (
    <main className="main">
      <h1 className="pageTitle">プログラムテスト</h1>
      <p className="lead">読み込み中…</p>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <ProgramRunner />
    </Suspense>
  );
}
