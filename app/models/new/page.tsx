import ModelForm from '@/components/models/ModelForm';
import Link from 'next/link';

export default function NewModelPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <div className="mb-8">
        <Link href="/models" className="text-xs text-zinc-400 hover:text-zinc-600 mb-4 inline-block">
          ← Back to Models
        </Link>
        <h1 className="text-3xl font-extrabold text-zinc-900 mb-1">Add Model</h1>
        <p className="text-zinc-500 text-sm">Add a new model to the provenance database.</p>
      </div>

      <ModelForm mode="create" />
    </div>
  );
}
