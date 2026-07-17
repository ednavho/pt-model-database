// -------------------------------------------------------------------
// PSEUDOCOMFY NODE SEAM
//
// The Package Workflow wizard detects four Pseudocomfy nodes in an
// uploaded ComfyUI graph. Three of them do not exist yet — Kyle is
// building them, and the class_type strings below are PLACEHOLDERS.
//
// TO INTEGRATE: replace the placeholder strings with the real
// class_type values and correct the field layouts. Nothing else needs
// to change.
// -------------------------------------------------------------------

// ── class_type strings ──────────────────────────────────────────────

/** Nerd drops this wherever a value should be jock-adjustable. PLACEHOLDER. */
export const PSEUDO_VARIABLE_NODE = 'PseudoVariable';

/** Nerd drops this wherever a seed should be jock-adjustable. PLACEHOLDER. */
export const PSEUDO_SEED_NODE = 'PseudoSeed';

/** Populates a model picker from the provenance database. PLACEHOLDER. */
export const PSEUDO_VETTED_MODEL_LOADER = 'PseudoVettedModelLoader';

/** CONFIRMED — appears in shipped pseudorandom workflows. */
export const PSEUDO_LOAD_MODEL_SNAPSHOT = 'PseudoLoadModelSnapshot';

// ── Field layouts ───────────────────────────────────────────────────
//
// `api` is the key under a node's `inputs` (ComfyUI "Save (API Format)").
// `ui` is the index into `widgets_values` (ComfyUI regular "Save"), which
// is positional — these indices are guesses until the nodes exist.

export const VARIABLE_NODE_FIELDS = {
  name: { api: 'name', ui: 0 },
  type: { api: 'type', ui: 1 },
  value: { api: 'value', ui: 2 },
};

export const SEED_NODE_FIELDS = {
  value: { api: 'value', ui: 0 },
};

export const VETTED_LOADER_FIELDS = {
  id: { api: 'id', ui: 0 },
  name_local: { api: 'name_local', ui: 1 },
  filename_local: { api: 'filename_local', ui: 2 },
  category_local: { api: 'category_local', ui: 3 },
};

export const SNAPSHOT_NODE_FIELDS = {
  // CONFIRMED — "string_path": "__PSEUDORANDOM_TEMP_PATH__"
  path: { api: 'string_path', ui: 0 },
};

// ── Reserved tokens ─────────────────────────────────────────────────
//
// These are written into the graph by the wizard, never typed by the nerd.
// Multiple seed nodes get ascending suffixes: __PSEUDORANDOM_SEED__,
// __PSEUDORANDOM_SEED_2__, __PSEUDORANDOM_SEED_3__ …

export const SEED_TOKEN = '__PSEUDORANDOM_SEED__';
export const TEMP_PATH_TOKEN = '__PSEUDORANDOM_TEMP_PATH__';

export function seedTokenAt(index: number): string {
  return index === 0 ? SEED_TOKEN : `__PSEUDORANDOM_SEED_${index + 1}__`;
}

/** "Mask Softness" → "__MASK_SOFTNESS__" */
export function tokenFromName(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug ? `__${slug}__` : '';
}

// ── Model requirement scanning ──────────────────────────────────────

/** ComfyUI's models/ subfolder names — the valid `category` values. */
export const COMFY_MODEL_FOLDERS = [
  'checkpoints',
  'clip',
  'clip_vision',
  'configs',
  'controlnet',
  'diffusers',
  'embeddings',
  'gligen',
  'hypernetworks',
  'ipadapter',
  'loras',
  'photomaker',
  'style_models',
  'unet',
  'upscale_models',
  'vae',
  'vae_approx',
] as const;

export type ComfyModelFolder = (typeof COMFY_MODEL_FOLDERS)[number];

/**
 * Weight-file extensions to scan for. We can't know every loader node that
 * ComfyUI and its extensions ship, so we look for filename-shaped strings
 * anywhere in the graph and let the nerd confirm which are real.
 */
export const MODEL_FILE_EXTENSIONS = [
  '.safetensors',
  '.ckpt',
  '.pt',
  '.pth',
  '.bin',
  '.onnx',
  '.sft',
  '.gguf',
];

// ── Extension (custom_nodes) requirements ───────────────────────────
//
// ComfyUI's API-format export carries NO record of which extension a node
// came from. The only signal available is the class_type prefix, so this is
// a heuristic: any node whose class_type starts with "Pseudo" means the
// workflow needs Pseudocomfy installed.
//
// Other extensions are not handled yet — pending more information.

export const PSEUDO_CLASS_TYPE_PREFIX = 'Pseudo';

export const PSEUDOCOMFY_REQUIREMENT = {
  category: 'custom_nodes',
  requirement: 'pseudocomfy',
  provenance: {
    attribution: 'Pseudotools - Pseudocomfy custom nodes for ComfyUI.',
    attribution_url: 'https://github.com/pseudotools/',
    download_url: 'https://github.com/pseudotools/pseudocomfy',
    license: 'GNU General Public License v3.0',
  },
};
