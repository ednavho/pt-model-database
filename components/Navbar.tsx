/** @format */

import Link from 'next/link';

export default function Navbar() {
  return (
    <nav className="w-full bg-white">
      <div className="px-6 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-zinc-900 hover:text-zinc-600"
        >
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
        </div>
      </div>
    </nav>
  );
}
