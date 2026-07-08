export type VettingStatus = 'vetted' | 'potentially_problematic' | 'unknown';

export interface Model {
  id: string;
  category_id: string;
  name: string | null;
  file_name: string;
  download_url: string | null;
  attribution: string | null;
  attribution_url: string | null;
  license: string | null;
  data_provenance_notes: string | null;
  size_bytes: number | null;
  vetting_status_id: string;
  used_by_workflows: string[] | null;
  created_at: string;
  updated_at: string;
  model_categories: { name: string } | null;
  vetting_statuses: { name: string } | null;
}

export interface ModelInsert {
  category_id: string;
  name?: string | null;
  file_name: string;
  download_url?: string | null;
  attribution?: string | null;
  attribution_url?: string | null;
  license?: string | null;
  data_provenance_notes?: string | null;
  size_bytes?: number | null;
  vetting_status_id?: string;
  used_by_workflows?: string[] | null;
}

export interface ModelUpdate extends Partial<ModelInsert> {}

export const MODEL_CATEGORIES = [
  'checkpoints',
  'controlnet',
  'loras',
  'clip_vision',
  'ipadapter',
] as const;

export type ModelCategory = (typeof MODEL_CATEGORIES)[number];
