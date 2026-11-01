"use client";

import { useEffect, useState } from "react";

export function IntroAnimation({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<"text" | "fade" | "done">("text");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("fade"), 2000);
    const t2 = setTimeout(() => {
      setPhase("done");
      onComplete();
    }, 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onComplete]);

  if (phase === "done") return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black transition-opacity duration-600 ${
        phase === "fade" ? "opacity-0" : "opacity-100"
      }`}
    >
      <h1 className="animate-intro text-4xl font-light tracking-widest text-zinc-200 sm:text-5xl">
        PRATH
      </h1>
    </div>
  );
}
