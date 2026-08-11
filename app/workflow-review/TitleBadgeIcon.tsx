'use client';

import { cn } from '@/utils/cn';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** TEST-ONLY ONE-OFF (edna/testing-purposes): swapped in for the title-row
 *  status pill on request — a static icon, not tied to summary.status like
 *  StatusPill is. Split into its own client component (unlike the page's
 *  other page-local icons) because the hover tooltip needs useState, and
 *  page.tsx is an async server component. Portal-positioned the same way
 *  as components/ui/InfoTooltip.tsx, to escape this page's own overflow
 *  clipping. */
export function TitleBadgeIcon() {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => setMounted(true), []);

  const show = useCallback(() => {
    const rect = iconRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
    setVisible(true);
  }, []);

  return (
    <span
      ref={iconRef}
      onMouseEnter={show}
      onMouseLeave={() => setVisible(false)}
      className="inline-flex cursor-default"
    >
      <svg width="30" height="33" viewBox="0 0 24 27" fill="none" className="shrink-0">
        <path
          d="M11.992 2.71484C12.0751 2.74859 12.6362 3.23288 12.7491 3.32237C13.0501 3.56259 13.3595 3.79217 13.6767 4.01066C15.573 5.29824 17.5814 6.08756 19.8389 6.46811C20.2491 6.53727 20.7032 6.62671 21.1161 6.66388C21.135 6.88095 21.1313 7.20941 21.1299 7.42719L21.1283 8.40842C21.135 10.5226 21.1396 12.5411 20.5823 14.5981C19.5811 18.2936 16.9707 19.7428 14 22C13.4603 22.4063 13.0626 22.626 12.5 23C12.2551 23.1633 12.1719 23.209 12.0428 23.209C11.5 23 11.5 23 11.5 23C9.78366 21.899 7.95635 20.8935 6.57565 19.3936C4 17 3.2373 15.2287 2.97376 11.9704C2.9286 11.5304 2.93637 11.0845 2.90724 10.6455C2.86633 10.0291 2.88127 9.42934 2.87711 8.81386C2.87535 8.55461 2.86713 8.30525 2.88144 8.04513C2.8883 7.9205 2.85256 7.76942 2.85799 7.64263C2.86831 7.31975 2.86804 6.99647 2.88373 6.67388C5.5816 6.34318 7.98943 5.629 10.2535 4.07039C10.6087 3.82521 10.9549 3.56739 11.2916 3.29747C11.5229 3.10911 11.7579 2.89492 11.992 2.71484Z"
          fill="#EE9E05"
        />
        <path
          d="M11.9941 4C12.0836 4.03956 12.4323 4.33056 12.5422 4.40919C12.9181 4.67735 13.3034 4.93226 13.6974 5.17343C15.6201 6.33029 17.7662 7.07552 19.9973 7.36116C20.0005 7.91387 20.0009 8.46659 19.9983 9.01929C19.996 10.4784 19.9708 11.8002 19.692 13.2398C19.0894 16.3522 17.4041 17.7957 14.9811 19.8146C13.9944 20.6368 13.0609 21.2837 11.9973 21.9963L11.9866 22C11.9321 21.9899 11.5618 21.7419 11.4918 21.6969C8.45256 19.7438 5.66317 18.1505 4.6286 14.6038C3.93096 12.2122 4.01498 9.83448 4 7.37423C6.50294 6.99987 8.76666 6.26387 10.873 4.83717C11.2327 4.59354 11.6705 4.28417 11.9941 4Z"
          fill="#F8F6EA"
        />
        <path
          d="M11.9902 6.40137C12.4524 6.40454 12.5748 6.69787 12.7826 7.04821C12.9153 7.27209 13.0507 7.49873 13.1844 7.72239L14.5274 9.95257L16.8219 13.7174L17.4998 14.8241C17.6392 15.0497 17.7825 15.2755 17.916 15.5045C17.9856 15.6237 18.0204 15.7288 18.0208 15.8685C18.0231 16.0553 17.9502 16.2352 17.8183 16.3676C17.5542 16.6324 17.1522 16.5725 16.805 16.5723L15.7568 16.5716L11.984 16.5723L8.19567 16.572L7.14415 16.5728C6.93671 16.5729 6.68875 16.586 6.48856 16.5582C6.00106 16.4904 5.76508 15.9306 6.0096 15.5181C6.13608 15.3047 6.26405 15.1074 6.39227 14.9028L7.17081 13.6636L9.4914 9.95088L10.957 7.54798C11.0781 7.34866 11.1981 7.14867 11.317 6.94801C11.4955 6.64885 11.6006 6.42772 11.9902 6.40137Z"
          fill="#EE9E05"
        />
        <path
          d="M11.5 9L12.5 9.00162L12.2996 13.6537L12.2845 13.9936C12.0936 14 11.8988 13.9971 11.7074 14C11.6963 13.5188 11.6657 13.0041 11.6459 12.5202L11.5 9Z"
          fill="#2D2C2B"
        />
        <path
          d="M11.9244 14.5058C12.1972 14.4641 12.4523 14.6514 12.4941 14.9242C12.536 15.197 12.3489 15.4521 12.0761 15.4941C11.8031 15.5362 11.5478 15.3488 11.5059 15.0758C11.464 14.8028 11.6514 14.5476 11.9244 14.5058Z"
          fill="#2D2C2B"
        />
      </svg>
      {mounted &&
        createPortal(
          <span
            className={cn(
              'pointer-events-none fixed z-50 opacity-0 transition-opacity w-max max-w-[240px] bg-white border border-[#E9E9E9] rounded-[6px] px-2.5 py-2 text-[11px] text-[#6B6B6B] leading-relaxed shadow-sm',
              visible && 'opacity-100'
            )}
            style={{ top: pos.top, left: pos.left }}
          >
            Some models used in this workflow were flagged as potentially problematic during review — see the Requirements section below for details.
          </span>,
          document.body
        )}
    </span>
  );
}
