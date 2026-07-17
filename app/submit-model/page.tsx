'use client';

import { MODEL_CATEGORIES } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import Link from 'next/link';
import { useState } from 'react';

const CATEGORY_LABELS: Record<string, string> = {
  checkpoints: 'Checkpoint',
  controlnet: 'ControlNet',
  loras: 'LoRA',
  clip_vision: 'Clip Vision',
  ipadapter: 'IPAdapter',
};

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1';
const inputClass =
  'block w-full border border-zinc-300 rounded-sm px-3 py-2 text-sm text-zinc-900 bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400';
const errorClass = 'text-xs text-red-600 mt-1';

interface FormState {
  name: string;
  source_url: string;
  submitted_by_name: string;
  submitted_by_email: string;
  file_name: string;
  category_id: string;
  license: string;
  attribution: string;
  attribution_url: string;
  data_provenance_notes: string;
  reason: string;
}

const empty: FormState = {
  name: '',
  source_url: '',
  submitted_by_name: '',
  submitted_by_email: '',
  file_name: '',
  category_id: '',
  license: '',
  attribution: '',
  attribution_url: '',
  data_provenance_notes: '',
  reason: '',
};

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default function SubmitModelPage() {
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const set = (field: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const validate = () => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) e.name = 'Model name is required.';
    if (!form.source_url.trim()) e.source_url = 'Source URL is required.';
    if (!form.submitted_by_name.trim()) e.submitted_by_name = 'Your name is required.';
    if (!form.submitted_by_email.trim()) {
      e.submitted_by_email = 'Your email is required.';
    } else if (!isValidEmail(form.submitted_by_email)) {
      e.submitted_by_email = 'Enter a valid email address.';
    }
    return e;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setSubmitting(true);
    setSubmitError(null);

    const supabase = createClient();
    const { error } = await supabase.from('model_submissions').insert({
      name: form.name.trim(),
      file_name: form.file_name.trim() || null,
      category_id: form.category_id || null,
      source_url: form.source_url.trim(),
      license: form.license.trim() || null,
      attribution: form.attribution.trim() || null,
      attribution_url: form.attribution_url.trim() || null,
      data_provenance_notes: form.data_provenance_notes.trim() || null,
      submitted_by_name: form.submitted_by_name.trim(),
      submitted_by_email: form.submitted_by_email.trim(),
      reason: form.reason.trim() || null,
    });

    if (error) {
      setSubmitError(error.message);
      setSubmitting(false);
      return;
    }

    setSuccess(true);
    setSubmitting(false);
  };

  if (success) {
    return (
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-16 text-center">
        <div className="border border-zinc-200 rounded-sm p-10">
          <div className="text-2xl font-extrabold text-zinc-900 mb-3">Request submitted</div>
          <p className="text-zinc-500 text-sm mb-8">
            Thanks — your request has been submitted for review. We&apos;ll look into it and add
            the model to the database if it meets our criteria.
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => { setForm(empty); setSuccess(false); }}
              className="text-xs border border-zinc-200 rounded-sm px-4 py-2 text-zinc-600 hover:border-zinc-400 transition-colors"
            >
              Submit another
            </button>
            <Link
              href="/models"
              className="text-xs border border-zinc-300 rounded-sm px-4 py-2 text-zinc-900 hover:bg-zinc-50 transition-colors"
            >
              Back to models
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-12">
      <div className="mb-8">
        <Link href="/models" className="text-xs text-zinc-400 hover:text-zinc-600 mb-4 inline-block">
          ← Back to Models
        </Link>
        <h1 className="text-3xl font-extrabold text-zinc-900 mb-2">Request a model</h1>
        <p className="text-zinc-500 text-sm">
          Know a model that should be in the database? Fill this out and we&apos;ll review it.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {submitError && (
          <div className="border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-sm">
            Something went wrong: {submitError}
          </div>
        )}

        {/* Required */}
        <div className="border border-zinc-200 rounded-sm p-6 space-y-5">
          <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500">Required</div>

          <div>
            <label className={labelClass}>Model name *</label>
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Juggernaut XL"
            />
            {errors.name && <p className={errorClass}>{errors.name}</p>}
          </div>

          <div>
            <label className={labelClass}>Source URL *</label>
            <input
              className={inputClass}
              type="url"
              value={form.source_url}
              onChange={(e) => set('source_url', e.target.value)}
              placeholder="https://huggingface.co/… or civitai.com/…"
            />
            {errors.source_url && <p className={errorClass}>{errors.source_url}</p>}
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <label className={labelClass}>Your name *</label>
              <input
                className={inputClass}
                value={form.submitted_by_name}
                onChange={(e) => set('submitted_by_name', e.target.value)}
                placeholder="Jane Smith"
              />
              {errors.submitted_by_name && <p className={errorClass}>{errors.submitted_by_name}</p>}
            </div>
            <div>
              <label className={labelClass}>Your email *</label>
              <input
                className={inputClass}
                type="email"
                value={form.submitted_by_email}
                onChange={(e) => set('submitted_by_email', e.target.value)}
                placeholder="jane@example.com"
              />
              {errors.submitted_by_email && <p className={errorClass}>{errors.submitted_by_email}</p>}
            </div>
          </div>
        </div>

        {/* Optional */}
        <div className="border border-zinc-200 rounded-sm p-6 space-y-5">
          <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500">Optional</div>

          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <label className={labelClass}>File name</label>
              <input
                className={inputClass}
                value={form.file_name}
                onChange={(e) => set('file_name', e.target.value)}
                placeholder="model.safetensors"
              />
            </div>
            <div>
              <label className={labelClass}>Category</label>
              <select
                className={inputClass}
                value={form.category_id}
                onChange={(e) => set('category_id', e.target.value)}
              >
                <option value="">Not sure</option>
                {MODEL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c] ?? c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>License</label>
            <input
              className={inputClass}
              value={form.license}
              onChange={(e) => set('license', e.target.value)}
              placeholder="e.g. CreativeML Open RAIL-M, Apache 2.0"
            />
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <label className={labelClass}>Attribution</label>
              <input
                className={inputClass}
                value={form.attribution}
                onChange={(e) => set('attribution', e.target.value)}
                placeholder="Creator or organization"
              />
            </div>
            <div>
              <label className={labelClass}>Attribution URL</label>
              <input
                className={inputClass}
                type="url"
                value={form.attribution_url}
                onChange={(e) => set('attribution_url', e.target.value)}
                placeholder="https://huggingface.co/…"
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Data provenance notes</label>
            <textarea
              className={`${inputClass} min-h-[80px] resize-y`}
              value={form.data_provenance_notes}
              onChange={(e) => set('data_provenance_notes', e.target.value)}
              placeholder="Training data, known issues, lineage…"
            />
          </div>

          <div>
            <label className={labelClass}>Why should this be added?</label>
            <textarea
              className={`${inputClass} min-h-[80px] resize-y`}
              value={form.reason}
              onChange={(e) => set('reason', e.target.value)}
              placeholder="What workflow uses it, why it's useful…"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="border border-zinc-300 rounded-sm px-6 py-2 text-sm font-medium text-zinc-900 bg-white hover:bg-zinc-50 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit for review'}
          </button>
          <Link
            href="/models"
            className="border border-zinc-200 rounded-sm px-6 py-2 text-sm text-zinc-500 hover:bg-zinc-50 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
