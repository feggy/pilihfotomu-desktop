/**
 * Pointers on the photo, as Lightroom's: an eyedropper for picking a colour
 * (white balance, Color Range), and the brush drawn as two rings — its size,
 * and inside it where the feather ends — with + (paint) or − (erase) at
 * the middle.
 */

import { useEffect, useState } from 'react';

/** An eyedropper, its tip at the bottom left where the colour is read. */
export const EYEDROPPER = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    '<g stroke="black" stroke-width="4"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></g>' +
    '<g stroke="white" stroke-width="1.6"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></g></svg>',
)}") 2 21, crosshair`;

/** The brush at the pointer: `size` across (px), the feather's ring inside, + or − at the middle. */
export function BrushRing({ x, y, size, feather, erase }: { x: number; y: number; size: number; feather: number; erase?: boolean }) {
  const inner = size * Math.max(0, 1 - feather / 100);
  const ring = 'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full';
  const shade = { boxShadow: '0 0 0 1px rgb(0 0 0 / 0.45), inset 0 0 0 1px rgb(0 0 0 / 0.45)' };
  return (
    <>
      <span className={`${ring} border-[1.5px] ${erase ? 'border-reject' : 'border-white'}`} style={{ left: x, top: y, width: size, height: size, ...shade }} />
      {inner > 6 && inner < size - 2 && (
        <span className={`${ring} border border-dashed ${erase ? 'border-reject/80' : 'border-white/80'}`} style={{ left: x, top: y, width: inner, height: inner }} />
      )}
      <span
        className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-[13px] leading-none font-bold ${erase ? 'text-reject' : 'text-white'}`}
        style={{ left: x, top: y, textShadow: '0 0 2px black' }}
      >
        {erase ? '−' : '+'}
      </span>
    </>
  );
}

/**
 * Where the pointer is over `box`, in its own (unscaled) pixels, kept right
 * while the photo zooms or scrolls under a still pointer: the pointer's
 * place on screen is kept, and the box is measured again each time.
 */
export function usePointerAt(box: React.RefObject<HTMLElement | null>) {
  const [client, setClient] = useState<{ x: number; y: number } | null>(null);
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!client) return;
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => redraw((n) => n + 1));
    };
    window.addEventListener('scroll', again, true);
    window.addEventListener('wheel', again, true);
    window.addEventListener('gesturechange', again, true);
    window.addEventListener('resize', again);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', again, true);
      window.removeEventListener('wheel', again, true);
      window.removeEventListener('gesturechange', again, true);
      window.removeEventListener('resize', again);
    };
  }, [!!client]);
  const el = box.current;
  let at: { x: number; y: number } | null = null;
  if (client && el) {
    const r = el.getBoundingClientRect();
    const k = r.width ? el.clientWidth / r.width : 1;
    at = { x: (client.x - r.left) * k, y: (client.y - r.top) * k };
  }
  return {
    at,
    move: (e: { clientX: number; clientY: number }) => setClient({ x: e.clientX, y: e.clientY }),
    leave: () => setClient(null),
  };
}
