import Link from 'next/link';

/**
 * Creating a model here is intentionally gone, not just unwired — model
 * provenance now lives on Hugging Face card repos, and this migration is
 * read-only (no write-back path to Hugging Face was built). This page
 * exists so the old /models/new link doesn't 404; it just explains where
 * adding a model actually happens now.
 */
export default function NewModelPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <div className="mb-8">
        <Link href="/models" className="text-xs text-zinc-400 hover:text-zinc-600 mb-4 inline-block">
          ← Back to Models
        </Link>
        <h1 className="text-3xl font-extrabold text-zinc-900 mb-1">Adding models has moved</h1>
      </div>

      <div className="border border-zinc-200 rounded-sm p-6 space-y-3 text-sm text-zinc-600">
        <p>
          Model provenance now lives on Hugging Face — each vetted model gets its own card repo
          under the pseudotools org — not this site, so there&apos;s no create form here anymore.
        </p>
        <p>To add a new model, set up its card repo directly on Hugging Face.</p>
      </div>
    </div>
  );
}
