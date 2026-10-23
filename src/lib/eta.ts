/**
 * A steady "time left" for a run whose speed wobbles: the first photos are
 * slow (models load, disk cache is cold), RAW files and group shots take
 * longer, and parallel workers report in bursts.
 *
 * - Speed is measured over the last few seconds, smoothed, so the slow start
 *   stops counting once it is past.
 * - The shown value counts down every second and only drifts toward the new
 *   estimate, so it never jumps around.
 * - Nothing is shown until there is enough to go on.
 */

import { useEffect, useRef, useState } from 'react';

const WINDOW_MS = 8_000;
/** How far the shown value moves toward a fresh estimate each second. */
const PULL = 0.2;

export interface Eta {
  /** Milliseconds left, rounded for display; null while warming up. */
  remainingMs: number | null;
  perMinute: number | null;
}

export function useEta(done: number, total: number, startedAt: number): Eta {
  const samples = useRef<{ t: number; done: number }[]>([]);
  const rate = useRef<number | null>(null); // photos per ms, smoothed
  const shown = useRef<number | null>(null);
  const [, tick] = useState(0);
  // Read by the 1-second timer; progress arrives far more often than that,
  // and restarting the timer on every photo would mean it never fires.
  const latest = useRef({ done, total, startedAt });
  latest.current = { done, total, startedAt };

  // Record progress as it arrives.
  useEffect(() => {
    const now = Date.now();
    const s = samples.current;
    if (!s.length || s[s.length - 1].done !== done) s.push({ t: now, done });
    while (s.length > 2 && now - s[0].t > WINDOW_MS) s.shift();
  }, [done]);

  // Once a second: update speed, pull the shown value toward the estimate, count down.
  useEffect(() => {
    const id = setInterval(() => {
      const { done, total, startedAt } = latest.current;
      const now = Date.now();
      const s = samples.current;
      const first = s[0];
      const last = s[s.length - 1];
      if (first && last && last.t - first.t >= 2_000 && last.done - first.done >= 2) {
        const inst = (last.done - first.done) / (now - first.t);
        rate.current = rate.current == null ? inst : rate.current * 0.7 + inst * 0.3;
      }
      const warm = now - startedAt >= 3_000 && done >= Math.max(3, total * 0.03);
      if (rate.current && warm && done < total) {
        const estimate = (total - done) / rate.current;
        shown.current =
          shown.current == null ? estimate : Math.max(0, shown.current - 1_000 + (estimate - shown.current) * PULL);
      } else if (done >= total) {
        shown.current = 0;
      }
      tick((n) => n + 1);
    }, 1_000);
    return () => clearInterval(id);
  }, []);

  return {
    remainingMs: shown.current == null ? null : roundForDisplay(shown.current),
    perMinute: rate.current ? Math.round((rate.current * 60_000) / 10) * 10 : null,
  };
}

/** Coarser the further away: "± 4 mnt", "± 1 mnt 30 dtk", "± 25 dtk". */
function roundForDisplay(ms: number) {
  const s = ms / 1000;
  if (s > 120) return Math.round(s / 60) * 60_000;
  if (s > 60) return Math.round(s / 10) * 10_000;
  return Math.max(5, Math.round(s / 5) * 5) * 1000;
}
