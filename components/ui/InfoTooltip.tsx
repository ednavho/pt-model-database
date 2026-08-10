'use client';

import { cn } from '@/utils/cn';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const TOOLTIP_MAX_W = 220;

export function InfoTooltip({ text }: { text: string }) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  // Portal target only exists post-mount, so this waits a tick to avoid an
  // SSR/hydration mismatch (the server has no document.body to attach to).
  useEffect(() => setMounted(true), []);

  const show = useCallback(() => {
    const rect = iconRef.current?.getBoundingClientRect();
    if (rect) {
      // Positioned via document.body rather than the icon's DOM parent —
      // several ancestors up the wizard's layout (the scrollable step
      // content, the max-width-capped middle column, the content row) all
      // clip with overflow-hidden/auto, so an absolutely-positioned tooltip
      // gets cut off there long before it'd reach the code panel beside it.
      // A fixed-position portal escapes that clipping entirely.
      const spaceRight = window.innerWidth - rect.right;
      const left =
        spaceRight >= TOOLTIP_MAX_W + 6 ? rect.right + 6 : Math.max(6, rect.left - TOOLTIP_MAX_W - 6);
      setPos({ top: rect.top + rect.height / 2, left });
    }
    setVisible(true);
  }, []);

  return (
    <span className="inline-flex items-center">
      <span
        ref={iconRef}
        onMouseEnter={show}
        onMouseLeave={() => setVisible(false)}
        className="w-3 h-3 rounded-full border border-[#D4D4D4] text-[#B0B0B0] text-[8px] font-semibold inline-flex items-center justify-center cursor-default select-none leading-none"
      >
        i
      </span>
      {mounted &&
        createPortal(
          <span
            className={cn(
              'pointer-events-none fixed -translate-y-1/2 z-50 opacity-0 transition-opacity w-max max-w-[220px] bg-white border border-[#E9E9E9] rounded-[6px] px-2.5 py-2 text-[11px] text-[#6B6B6B] leading-relaxed shadow-sm',
              visible && 'opacity-100'
            )}
            style={{ top: pos.top, left: pos.left }}
          >
            {text}
          </span>,
          document.body
        )}
    </span>
  );
}
