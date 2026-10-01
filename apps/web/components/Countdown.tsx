"use client";

import { useEffect, useState } from "react";

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function Countdown({ endIso }: { endIso: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) {
    return <span className="font-mono tabular-nums">--:--:--</span>;
  }

  const remainingMs = Math.max(0, new Date(endIso).getTime() - now);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <span className="font-mono tabular-nums">
      {pad(hours)}:{pad(minutes)}:{pad(seconds)}
    </span>
  );
}
