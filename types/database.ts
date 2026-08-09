// Model provenance moved to Hugging Face card repos (see lib/modelCards.ts)
// and is no longer read from Supabase, except for the lineage feature,
// which is a separate, deliberately still-Supabase-based track. This type
// is the one piece of the old model schema still load-bearing there —
// app/image-info/ImageInfoViewer.tsx and components/ui/VettingBadge.tsx
// both still use it for lineage-tab rendering. Everything else that used
// to live in this file (Model, ModelDetail, ModelInsert, ModelUpdate,
// MODEL_CATEGORIES) had no remaining callers once the models pages and
// forms were migrated, and was removed rather than left as dead exports
// of a schema nothing writes anymore.
export type VettingStatus = 'vetted' | 'potentially_problematic' | 'unknown';
