import Link from 'next/link';

export default function Home() {
  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-16 md:py-24">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-extrabold text-zinc-900 mb-3">
          Pseudorandom Model Provenance
        </h1>
        <p className="text-zinc-500 text-lg max-w-xl mx-auto">
          A database of vetted AI models and a tool for packaging Pseudorandom-ready workflows.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
        <Link
          href="/models"
          className="block border border-zinc-200 rounded-sm p-6 hover:border-zinc-400 transition-colors"
        >
          <div className="font-semibold text-zinc-900 mb-2">Model Database</div>
          <p className="text-sm text-zinc-500">
            Browse vetted models, filter by category or status, and view full provenance information.
          </p>
        </Link>

        <Link
          href="/package-workflow"
          className="block border border-zinc-200 rounded-sm p-6 hover:border-zinc-400 transition-colors"
        >
          <div className="font-semibold text-zinc-900 mb-2">Package Workflow</div>
          <p className="text-sm text-zinc-500">
            Convert a raw ComfyUI workflow export into a Pseudorandom-ready workflow file with provenance attached.
          </p>
        </Link>

        <Link
          href="/models/new"
          className="block border border-zinc-200 rounded-sm p-6 hover:border-zinc-400 transition-colors"
        >
          <div className="font-semibold text-zinc-900 mb-2">Add Model</div>
          <p className="text-sm text-zinc-500">
            Add a new model record to the database with provenance and vetting information.
          </p>
        </Link>
      </div>
    </div>
  );
}
