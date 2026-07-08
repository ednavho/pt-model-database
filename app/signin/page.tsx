'use client';

import { createClient } from '@/utils/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1';
const inputClass =
  'block w-full border border-zinc-300 rounded-sm px-3 py-2 text-sm text-zinc-900 bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400';

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push(next);
      router.refresh();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50">
      <div className="w-full max-w-sm border border-zinc-200 rounded-sm bg-white p-8">
        <h1 className="text-lg font-semibold text-zinc-900 mb-1">Sign In</h1>
        <p className="text-xs text-zinc-400 mb-6">Use your Pseudorandom account credentials.</p>

        {error && (
          <div className="mb-4 text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label className={labelClass}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full border border-zinc-300 rounded-sm px-4 py-2 text-sm font-medium text-zinc-900 bg-white hover:bg-zinc-50 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
