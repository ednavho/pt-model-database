'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import RiskBadge from '@/components/ui/RiskBadge';
import { formatBytes, type ModelCardRecord } from '@/lib/modelCards';
import { cn } from '@/utils/cn';
import FilterDropdown from '@/components/models/FilterDropdown';

type FilterOption = { value: string; label: string };

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

export default function ModelsList({
  models,
  totalCount,
  selectedCategories,
  selectedRisks,
  categoryOptions,
  riskOptions,
}: {
  models: ModelCardRecord[];
  totalCount: number;
  selectedCategories: string[];
  selectedRisks: string[];
  categoryOptions: FilterOption[];
  riskOptions: FilterOption[];
}) {
  const [search, setSearch] = useState('');

  const matchesCategory = (m: ModelCardRecord) =>
    selectedCategories.length === 0 || selectedCategories.includes(m.category);
  const matchesRisk = (m: ModelCardRecord) =>
    selectedRisks.length === 0 || selectedRisks.includes(m.status);
  const matchesSearch = (m: ModelCardRecord) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      m.display_name.toLowerCase().includes(q) || (m.requirement ?? '').toLowerCase().includes(q)
    );
  };

  const filtered = models.filter((m) => matchesCategory(m) && matchesRisk(m) && matchesSearch(m));
  // categoryOptions already has the display label per category (e.g.
  // "clip_vision" -> "Clip Vision") — reuse it here instead of a plain CSS
  // capitalize, which can't turn "clip_vision" into "Clip Vision" since
  // there's no word-break at an underscore.
  const categoryLabel = (cat: string) => categoryOptions.find((o) => o.value === cat)?.label ?? cat;

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <Suspense fallback={<div className="h-8 w-[120px] rounded-[8px] bg-zinc-50 border border-[#E9E9E9]" />}>
          <FilterDropdown
            dropdownLabel="Type"
            options={categoryOptions}
            selected={selectedCategories}
            paramName="category"
          />
        </Suspense>
        <Suspense fallback={<div className="h-8 w-[120px] rounded-[8px] bg-zinc-50 border border-[#E9E9E9]" />}>
          <FilterDropdown
            dropdownLabel="Risk"
            options={riskOptions}
            selected={selectedRisks}
            paramName="risk"
          />
        </Suspense>
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-[#939393]">
            <SearchIcon />
          </div>
          <input
            type="text"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-[#E9E9E9] rounded-[8px] pl-8 pr-3 py-[7px] text-[14px] outline-none focus:border-[#B0B0B0] bg-white w-full transition-colors"
          />
        </div>
      </div>

      <div className="border border-[#E9E9E9] rounded-[8px] overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[35%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[25%]" />
            <col className="w-[10%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-[#E9E9E9]">
              {['Name', 'Category', 'Status', 'License', 'Size', 'Download'].map((col) => (
                <th
                  key={col}
                  className={cn(
                    'text-[14px] font-medium text-black px-4 py-3 whitespace-nowrap',
                    col === 'Download' ? 'text-center' : 'text-left'
                  )}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-zinc-400 px-4 py-12 text-[13px]">
                  No models found.
                </td>
              </tr>
            ) : (
              filtered.map((model) => (
                <tr key={model.record_id} className="border-b border-[#E9E9E9] last:border-0 hover:bg-zinc-50/50">
                  <td className="px-4 py-3 overflow-hidden">
                    <Link
                      href={`/models/${model.record_id}`}
                      className="text-black hover:underline block truncate text-[14px]"
                    >
                      {model.display_name}
                    </Link>
                    {model.requirement && (
                      <span className="block truncate text-[11px] font-mono" style={{ color: '#939393' }}>
                        {model.requirement}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-zinc-600 truncate">
                    {model.category ? categoryLabel(model.category) : '—'}
                  </td>
                  <td className="px-4 py-3 overflow-hidden">
                    <RiskBadge record={model} />
                  </td>
                  <td className="px-4 py-3 text-[13px] text-zinc-500 truncate" title={model.provenance.license_id ?? undefined}>
                    {model.provenance.license_id ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-zinc-500 whitespace-nowrap">
                    {formatBytes(model.provenance.size_bytes)}
                  </td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    {model.provenance.download_url ? (
                      <a
                        href={model.provenance.download_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-[30px] h-[30px] border border-[#D8D8D8] rounded-[8px] text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 transition-colors"
                        title="Download"
                      >
                        <DownloadIcon />
                      </a>
                    ) : (
                      <span className="text-zinc-300 text-[13px]">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <p className="text-[12px] text-zinc-400 mt-3 text-right">
          {filtered.length < totalCount
            ? `${filtered.length} out of ${totalCount} models shown`
            : `${filtered.length} model${filtered.length !== 1 ? 's' : ''}`}
        </p>
      )}
    </>
  );
}
