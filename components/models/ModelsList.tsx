'use client';

import { useState } from 'react';
import Link from 'next/link';
import VettingBadge from '@/components/ui/VettingBadge';
import { VettingStatus } from '@/types/database';

type ModelRow = {
  id: string;
  name: string | null;
  file_name: string;
  download_url: string | null;
  license: string | null;
  size_bytes: number | null;
  model_categories: { name: string } | null;
  vetting_statuses: { name: string } | null;
};

const LABELS: Record<string, string> = {
  checkpoints: 'Checkpoint',
  controlnet: 'ControlNet',
  loras: 'LoRA',
  clip_vision: 'Clip Vision',
  ipadapter: 'IPAdapter',
};

function formatBytes(bytes: number | null) {
  if (!bytes) return '—';
  const gb = bytes / 1_073_741_824;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1_048_576;
  return `${mb.toFixed(0)} MB`;
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export default function ModelsList({ models }: { models: ModelRow[] }) {
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? models.filter((m) => {
        const q = search.toLowerCase();
        return (m.name?.toLowerCase().includes(q) || m.file_name.toLowerCase().includes(q));
      })
    : models;

  return (
    <>
      <div className="mb-5">
        <input
          type="text"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-[#E9E9E9] rounded-[8px] px-3 py-[7px] text-[14px] outline-none focus:border-[#B0B0B0] bg-white w-full transition-colors"
        />
      </div>

      <div className="border border-[#E9E9E9] rounded-[8px] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E9E9E9]">
              {['Name', 'Category', 'Status', 'License', 'Size', 'Download'].map((col) => (
                <th key={col} className="text-left text-[14px] font-medium text-black px-4 py-3">
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
                <tr key={model.id} className="border-b border-[#E9E9E9] last:border-0 hover:bg-zinc-50/50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/models/${model.id}`}
                      className="font-medium text-black hover:underline block text-[13px]"
                    >
                      {model.name ?? model.file_name}
                    </Link>
                    {model.name && (
                      <span className="text-[12px] font-mono" style={{ color: '#939393' }}>
                        {model.file_name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-zinc-600">
                    {LABELS[model.model_categories?.name?.toLowerCase() ?? ''] ?? model.model_categories?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <VettingBadge status={model.vetting_statuses?.name?.toLowerCase() as VettingStatus} />
                  </td>
                  <td className="px-4 py-3 text-[13px] text-zinc-500">
                    {model.license ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-zinc-500">
                    {formatBytes(model.size_bytes)}
                  </td>
                  <td className="px-4 py-3">
                    {model.download_url ? (
                      <a
                        href={model.download_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-[30px] h-[30px] border border-[#D8D8D8] rounded-[8px] text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 transition-colors"
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
          {filtered.length} model{filtered.length !== 1 ? 's' : ''}
        </p>
      )}
    </>
  );
}
