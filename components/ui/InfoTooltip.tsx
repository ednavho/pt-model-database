'use client';

export function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center">
      <span className="w-3.5 h-3.5 rounded-full border border-[#D4D4D4] text-[#B0B0B0] text-[9px] font-semibold flex items-center justify-center cursor-default select-none leading-none">
        i
      </span>
      <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 z-50 opacity-0 group-hover:opacity-100 transition-opacity w-52 bg-white border border-[#E9E9E9] rounded-[6px] px-2.5 py-2 text-[11px] text-[#555] leading-relaxed shadow-sm">
        {text}
      </span>
    </span>
  );
}
