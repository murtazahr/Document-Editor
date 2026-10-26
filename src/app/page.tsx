import { Suspense } from "react";
import ProjectList from "@/components/workspace/ProjectList";

export default function Home() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-6 py-12 text-muted">Loading…</main>}>
      <ProjectList />
    </Suspense>
  );
}
