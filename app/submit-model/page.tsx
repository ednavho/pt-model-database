import Link from 'next/link';

/**
 * This used to write to the Supabase model_submissions table. That table
 * is no longer the source of truth for model data (see the Hugging Face
 * migration), and this task doesn't build a write-back path to Hugging
 * Face, so there's nowhere for a submission to actually go right now.
 * Replaced with a static explanation rather than leaving a form that
 * silently no-ops or errors. The exact contact channel below is a
 * placeholder — confirm the real one before shipping this copy.
 */
export default function SubmitModelPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-16 text-center">
      <div className="border border-zinc-200 rounded-sm p-10">
        <div className="text-2xl font-extrabold text-zinc-900 mb-3">Model requests have moved</div>
        <p className="text-zinc-500 text-sm mb-8">
          Model provenance now lives on Hugging Face card repos rather than this database, so
          there&apos;s no submission form here anymore. Know a model that should be added?
          Reach out to the pseudotools team to get a card repo set up.
        </p>
        <Link
          href="/models"
          className="text-xs border border-zinc-300 rounded-sm px-4 py-2 text-zinc-900 hover:bg-zinc-50 transition-colors"
        >
          Back to models
        </Link>
      </div>
    </div>
  );
}
