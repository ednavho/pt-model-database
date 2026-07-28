'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface Option {
  value: string;
  label: string;
}

export default function FilterDropdown({
  dropdownLabel,
  options,
  selected,
  paramName,
}: {
  dropdownLabel: string;
  options: Option[];
  selected: string[];
  paramName: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    const params = new URLSearchParams(searchParams.toString());
    if (next.length > 0) params.set(paramName, next.join(','));
    else params.delete(paramName);
    router.push(`/models?${params.toString()}`);
  };

  const displayText =
    selected.length === 0
      ? 'All'
      : selected.map((s) => options.find((o) => o.value === s)?.label ?? s).join(', ');

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 border border-[#E9E9E9] rounded-[8px] px-3 py-[7px] bg-white min-w-[100px] max-w-[240px] hover:border-[#C0C0C0] transition-colors"
      >
        <span className="text-[#939393] shrink-0 text-[14px]">{dropdownLabel}:</span>
        <span className="truncate text-black text-[14px]">{displayText}</span>
        <svg className="ml-auto shrink-0 text-[#939393]" width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-[#E9E9E9] rounded-[8px] z-20 min-w-[200px] py-1 shadow-sm">
          {options.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-zinc-50 text-[14px]"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="rounded accent-black"
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
