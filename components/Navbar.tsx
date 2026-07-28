/** @format */

'use client';

import { createClient } from '@/utils/supabase/client';
import { isInternalUser } from '@/utils/auth';
import type { User } from '@supabase/supabase-js';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    router.push('/');
    router.refresh();
  };

  const internal = isInternalUser(user?.email);

  return (
    <nav className="w-full bg-white">
      <div className="px-6 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-zinc-900 hover:text-zinc-600"
        >
          {/* <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="8" height="8" stroke="currentColor" strokeWidth="1.5" />
            <rect x="11" y="1" width="8" height="8" stroke="currentColor" strokeWidth="1.5" />
            <rect x="1" y="11" width="8" height="8" stroke="currentColor" strokeWidth="1.5" />
            <rect x="11" y="11" width="8" height="8" fill="currentColor" />
          </svg> */}
          <span className="text-sm font-medium">Home</span>
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href="/package-workflow"
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            Package Workflow
          </Link>

          <Link
            href="/image-info"
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            Image Info
          </Link>

          {/* Standalone prototype — not the database-backed lineage feature. */}
          <Link
            href="/lineage-sketch"
            className="text-sm text-zinc-400 hover:text-zinc-900"
          >
            Lineage sketch
          </Link>

          {user && internal && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-400">
                {user.email}
                <span className="ml-1.5 text-zinc-300 font-medium uppercase tracking-wide">
                  · Internal
                </span>
              </span>
              <button
                onClick={handleSignOut}
                className="text-sm border border-zinc-300 rounded-sm px-3 py-1.5 bg-white text-zinc-900 hover:bg-zinc-50 transition-colors"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
