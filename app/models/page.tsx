import ModelsList from '@/components/models/ModelsList';
import {
  ASSESSMENT_BADGE_VALUES,
  BADGE_TAG_META,
  CATEGORY_LABELS,
  RECOGNIZED_CATEGORIES,
  listModelRepos,
  fetchModelCard,
} from '@/lib/modelCards';

interface SearchParams {
  category?: string;
  risk?: string;
}

// String-valued (URL query params are always strings) even though the
// badge itself is a number — ModelsList compares against String(m.badge).
const RISK_OPTIONS = ASSESSMENT_BADGE_VALUES.map((value) => ({
  value: String(value),
  label: BADGE_TAG_META[value].label,
}));

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { category, risk } = await searchParams;
  const selectedCategories = category ? category.split(',').filter(Boolean) : [];
  const selectedRisks = risk ? risk.split(',').filter(Boolean) : [];

  // Only ~19 repos exist right now, so fetching each one's full card here
  // (rather than just the cheap list) is fine — this is an occasionally-
  // loaded admin page, not the fast/frequent path the wizard-facing list
  // endpoint has to stay cheap for. Revisit if the catalog grows large
  // enough to make this slow.
  const repos = await listModelRepos();
  const records = await Promise.all(repos.map((r) => fetchModelCard(r.record_id)));
  const models = records.filter((m): m is NonNullable<typeof m> => m !== null);

  return (
    <div className="px-6 pt-10 pb-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-[40px] font-bold leading-none tracking-tight text-black">
          Model Database
        </h1>
        <p className="text-[15px] font-normal mt-2" style={{ color: '#878787' }}>
          Checked models, ready to use in your workflow
        </p>
      </div>

      <ModelsList
        models={models}
        totalCount={models.length}
        selectedCategories={selectedCategories}
        selectedRisks={selectedRisks}
        categoryOptions={RECOGNIZED_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] ?? c }))}
        riskOptions={RISK_OPTIONS}
      />
    </div>
  );
}
