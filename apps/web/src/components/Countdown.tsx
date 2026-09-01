import { useEffect, useState } from 'react';
import { formatCountdown, msUntil } from '../lib/format';

/** Live mm:ss countdown to `expiresAt`; calls `onElapsed` once when it hits 0. */
export function Countdown({
  expiresAt,
  onElapsed,
}: {
  expiresAt: string;
  onElapsed?: () => void;
}) {
  const [remaining, setRemaining] = useState(() => msUntil(expiresAt));

  useEffect(() => {
    setRemaining(msUntil(expiresAt));
    const id = window.setInterval(() => {
      const next = msUntil(expiresAt);
      setRemaining(next);
      if (next <= 0) {
        window.clearInterval(id);
        onElapsed?.();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt, onElapsed]);

  const expired = remaining <= 0;
  return (
    <span
      className={`font-mono text-sm font-semibold ${expired ? 'text-rose-600' : 'text-slate-900'}`}
    >
      {expired ? 'expired' : formatCountdown(remaining)}
    </span>
  );
}
