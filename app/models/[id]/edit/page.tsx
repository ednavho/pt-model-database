import ModelForm from '@/components/models/ModelForm';
import { Model } from '@/types/database';
import { createClient } from '@/utils/supabase/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function EditModelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: model, error } = await supabase
    .from('models')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !model) notFound();

  const m = model as Model;

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <div className="mb-8">
        <Link
          href={`/models/${m.id}`}
          className="text-xs text-zinc-400 hover:text-zinc-600 mb-4 inline-block"
        >
          ← Back to {m.name ?? m.file_name}
        </Link>
        <h1 className="text-3xl font-extrabold text-zinc-900 mb-1">Edit Model</h1>
        <p className="font-mono text-sm text-zinc-500">{m.file_name}</p>
      </div>

      <ModelForm mode="edit" modelId={m.id} initialValues={m} />
    </div>
  );
}
