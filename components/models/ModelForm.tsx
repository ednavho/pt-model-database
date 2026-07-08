'use client';

import { MODEL_CATEGORIES, ModelInsert } from '@/types/database';
import { cn } from '@/utils/cn';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

interface ModelFormProps {
  initialValues?: Partial<ModelInsert & { id: string }>;
  mode: 'create' | 'edit';
  modelId?: string;
}

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1';
const inputClass =
  'block w-full border border-zinc-300 rounded-sm px-3 py-2 text-sm text-zinc-900 bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400';
const selectClass = inputClass;

export default function ModelForm({ initialValues, mode, modelId }: ModelFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<ModelInsert>({
    category_id: initialValues?.category_id ?? '',
    name: initialValues?.name ?? '',
    file_name: initialValues?.file_name ?? '',
    download_url: initialValues?.download_url ?? '',
    attribution: initialValues?.attribution ?? '',
    attribution_url: initialValues?.attribution_url ?? '',
    license: initialValues?.license ?? '',
    data_provenance_notes: initialValues?.data_provenance_notes ?? '',
    size_bytes: initialValues?.size_bytes ?? null,
    vetting_status_id: initialValues?.vetting_status_id ?? '',
    used_by_workflows: initialValues?.used_by_workflows ?? [],
  });

  const set = (field: keyof ModelInsert, value: unknown) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      ...form,
      name: form.name || null,
      download_url: form.download_url || null,
      attribution: form.attribution || null,
      attribution_url: form.attribution_url || null,
      license: form.license || null,
      data_provenance_notes: form.data_provenance_notes || null,
      size_bytes: form.size_bytes || null,
      used_by_workflows:
        Array.isArray(form.used_by_workflows) && (form.used_by_workflows as string[]).length > 0
          ? form.used_by_workflows
          : null,
    };

    try {
      const url = mode === 'create' ? '/api/models' : `/api/models/${modelId}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Request failed');
      }

      const saved = await res.json();
      router.push(`/models/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-sm">
          {error}
        </div>
      )}

      {/* Required fields */}
      <div className="border border-zinc-200 rounded-sm p-6 space-y-5">
        <div className="font-semibold text-zinc-900 text-sm uppercase tracking-wide">
          Required
        </div>

        <div>
          <label className={labelClass}>Category *</label>
          <select
            className={selectClass}
            value={form.category_id}
            onChange={(e) => set('category_id', e.target.value)}
            required
          >
            <option value="">Select a category</option>
            {MODEL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>File Name *</label>
          <input
            className={inputClass}
            value={form.file_name}
            onChange={(e) => set('file_name', e.target.value)}
            placeholder="e.g. Juggernaut_X_RunDiffusion_Hyper.safetensors"
            required
          />
          <p className="text-xs text-zinc-400 mt-1">
            Exact filename ComfyUI expects — this is what workflow requirement fields match against.
          </p>
        </div>

        <div>
          <label className={labelClass}>Vetting Status</label>
          <select
            className={selectClass}
            value={form.vetting_status_id ?? ''}
            onChange={(e) => set('vetting_status_id', e.target.value)}
          >
            <option value="unknown">Unknown</option>
            <option value="vetted">Vetted</option>
            <option value="potentially_problematic">Potentially Problematic</option>
          </select>
        </div>
      </div>

      {/* Optional fields */}
      <div className="border border-zinc-200 rounded-sm p-6 space-y-5">
        <div className="font-semibold text-zinc-900 text-sm uppercase tracking-wide">
          Optional
        </div>

        <div>
          <label className={labelClass}>Display Name</label>
          <input
            className={inputClass}
            value={form.name ?? ''}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Human-readable model name"
          />
        </div>

        <div>
          <label className={labelClass}>Download URL</label>
          <input
            className={inputClass}
            type="url"
            value={form.download_url ?? ''}
            onChange={(e) => set('download_url', e.target.value)}
            placeholder="https://huggingface.co/..."
          />
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <label className={labelClass}>Attribution</label>
            <input
              className={inputClass}
              value={form.attribution ?? ''}
              onChange={(e) => set('attribution', e.target.value)}
              placeholder="Creator / organization name"
            />
          </div>
          <div>
            <label className={labelClass}>Attribution URL</label>
            <input
              className={inputClass}
              type="url"
              value={form.attribution_url ?? ''}
              onChange={(e) => set('attribution_url', e.target.value)}
              placeholder="https://huggingface.co/..."
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>License</label>
          <input
            className={inputClass}
            value={form.license ?? ''}
            onChange={(e) => set('license', e.target.value)}
            placeholder="e.g. CreativeML Open RAIL-M, Apache 2.0"
          />
        </div>

        <div>
          <label className={labelClass}>Data Provenance Notes</label>
          <textarea
            className={cn(inputClass, 'min-h-[80px] resize-y')}
            value={form.data_provenance_notes ?? ''}
            onChange={(e) => set('data_provenance_notes', e.target.value)}
            placeholder="Notes about training data, lineage, known issues..."
          />
        </div>

        <div>
          <label className={labelClass}>File Size (bytes)</label>
          <input
            className={inputClass}
            type="number"
            value={form.size_bytes ?? ''}
            onChange={(e) =>
              set('size_bytes', e.target.value ? parseInt(e.target.value, 10) : null)
            }
            placeholder="e.g. 7500000000"
          />
        </div>

        <div>
          <label className={labelClass}>Used By Workflows</label>
          <input
            className={inputClass}
            value={(form.used_by_workflows as string[] | null)?.join(', ') ?? ''}
            onChange={(e) =>
              set(
                'used_by_workflows',
                e.target.value
                  ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                  : []
              )
            }
            placeholder="Comma-separated workflow names or IDs"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="border border-zinc-300 rounded-sm px-6 py-2 text-sm font-medium text-zinc-900 bg-white hover:bg-zinc-50 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : mode === 'create' ? 'Create Model' : 'Save Changes'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="border border-zinc-200 rounded-sm px-6 py-2 text-sm text-zinc-500 hover:bg-zinc-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
