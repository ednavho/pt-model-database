// -------------------------------------------------------------------
// PSEUDOCOMFY NODE SEAM
//
// The Package Workflow wizard detects Pseudocomfy nodes in an uploaded
// ComfyUI graph. Several of these nodes don't exist yet — the
// class_type strings below are PLACEHOLDERS until Kyle confirms them.
//
// Every one of these nodes follows the same shape (confirmed):
//   { "class_type": "<name>", "inputs": { "value": <thing to replace> } }
//
// TO INTEGRATE: fix the class_type strings here. Nothing else changes.
// -------------------------------------------------------------------

export type VarType = 'int' | 'float' | 'string';

// ── class_type strings ──────────────────────────────────────────────

/** Marks a field the plugin should treat as the render seed. PLACEHOLDER. */
export const PSEUDO_SEED_NODE = 'PseudoSeed';

/**
 * One node type per data type — the matched class_type IS the type, so
 * there's no type field to read.
 */
export const PSEUDO_VARIABLE_CLASS_TYPES: Record<string, VarType> = {
  PseudoVarInt: 'int',
  PseudoVarFloat: 'float',
  PseudoVarString: 'string',
};

/** Marks a model selected from the provenance database. PLACEHOLDER. */
export const PSEUDO_VETTED_MODEL_LOADER = 'PseudoVettedModelLoader';

/** CONFIRMED — appears in shipped workflows carrying a real local path. */
export const PSEUDO_LOAD_MODEL_SNAPSHOT = 'PseudoLoadModelSnapshot';

/**
 * CONFIRMED — unpacks the snapshot into its guidance outputs. Its output slots
 * are what downstream nodes wire into, and which slots are wired tells us which
 * guidance capabilities the workflow actually uses.
 */
export const PSEUDO_UNPACK_MODEL_SNAPSHOT = 'PseudoUnpackModelSnapshot';

/**
 * Output slots of PseudoUnpackModelSnapshot → the capability flag each one
 * drives. A workflow that wires slot N into any node is using that capability,
 * so the wizard can tick the box for the nerd. Slot 2 (masks) has no flag.
 *
 *   0 mat_txts     → regional guidance: text
 *   1 mat_imgs     → regional guidance: image
 *   2 mat_msks     → (no flag)
 *   3 env_scene    → global guidance: txt_scene
 *   4 env_style    → global guidance: txt_style
 *   5 env_negative → global guidance: txt_negative
 *   6 img_depth    → spatial guidance: depth
 *   7 img_edge     → spatial guidance: edge
 *   8 img_style    → global guidance: img_style
 */
export const SNAPSHOT_SLOT_CAPABILITIES: Record<
  number,
  { group: string; key: string }
> = {
  0: { group: 'regional_guidance_capabilities', key: 'text' },
  1: { group: 'regional_guidance_capabilities', key: 'image' },
  3: { group: 'global_guidance_capabilities', key: 'txt_scene' },
  4: { group: 'global_guidance_capabilities', key: 'txt_style' },
  5: { group: 'global_guidance_capabilities', key: 'txt_negative' },
  6: { group: 'spatial_guidance_capabilities', key: 'depth' },
  7: { group: 'spatial_guidance_capabilities', key: 'edge' },
  8: { group: 'global_guidance_capabilities', key: 'img_style' },
};

// ── Field layouts ───────────────────────────────────────────────────
//
// Keys under a node's `inputs`. The wizard only accepts API-format
// exports, so these are always names — never widget indices.

/**
 * The input key holding a node's editable value — the thing the wizard reads
 * for a default and overwrites with a token on export. Confirmed nodes use
 * `val` (PseudoVarFloat/Int/String); earlier placeholder fixtures used
 * `value`. Tried in order, and the first key actually present on a node wins,
 * so a mix of both across node types just works.
 */
export const VALUE_INPUT_KEYS = ['val', 'value'];

// CONFIRMED — a Variable node's name is its title (`_meta.title` in API
// format), whatever the nerd renamed the node to in ComfyUI.

export const VETTED_LOADER_FIELDS = {
  id: 'id',
  name_local: 'name_local',
  filename_local: 'filename_local',
  category_local: 'category_local',
};

export const SNAPSHOT_NODE_FIELDS = {
  // CONFIRMED — holds an absolute local path pre-export.
  path: 'string_path',
};

// ── Reserved tokens ─────────────────────────────────────────────────
//
// Hardcoded on the plugin side. Never typed by the nerd, never listed in
// variables[], and never given a binds_to.

export const SEED_TOKEN = '__PSEUDORANDOM_SEED__';
export const TEMP_PATH_TOKEN = '__PSEUDORANDOM_TEMP_PATH__';

/** "mask softness" → "__MASK_SOFTNESS__" */
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

// ── Loaders that pick models by preset, not filename ────────────────
//
// Some loaders select weights through a preset label — "PLUS (high
// strength)" — and resolve it to real files at runtime. The filename never
// appears in the graph, so the scan above cannot see these models at all.
//
// We can't name the files without encoding each extension's preset table,
// which would drift out of date. Instead we flag the node so the nerd knows
// something is there and can add it deliberately.

export const PRESET_LOADER_CLASS_TYPES: Record<
  string,
  { presetField: string; loads: ComfyModelFolder[]; note: string }
> = {
  PseudoIPAdapterUnifiedLoaderClone: {
    presetField: 'preset',
    loads: ['ipadapter', 'clip_vision'],
    note: 'Resolves its preset to an IPAdapter model and a CLIP vision model when the workflow runs.',
  },
  IPAdapterUnifiedLoader: {
    presetField: 'preset',
    loads: ['ipadapter', 'clip_vision'],
    note: 'Resolves its preset to an IPAdapter model and a CLIP vision model when the workflow runs.',
  },
  IPAdapterUnifiedLoaderFaceID: {
    presetField: 'preset',
    loads: ['ipadapter', 'clip_vision'],
    note: 'Resolves its preset to a FaceID IPAdapter model and a CLIP vision model when the workflow runs.',
  },
};

/**
 * A catch-all net under the named preset loaders above: by ComfyUI convention
 * a node whose class_type contains "Loader" loads an asset off disk. Most
 * expose a filename the scan already sees; the ones that don't (like the
 * IPAdapter unified loaders) would otherwise vanish. So any loader-named node
 * that yields no filename gets flagged too — a generic version of the same
 * safety net, so an unfamiliar loader isn't silently dropped.
 *
 * These aren't loaders in the model sense and must not be flagged.
 */
const NON_MODEL_LOADER_CLASS_TYPES = new Set<string>([
  PSEUDO_LOAD_MODEL_SNAPSHOT, // loads scene data from Rhino, not a model
]);

export function looksLikeModelLoader(classType: string): boolean {
  if (NON_MODEL_LOADER_CLASS_TYPES.has(classType)) return false;
  if (classType === PSEUDO_VETTED_MODEL_LOADER) return false; // handled via the DB
  if (classType in PRESET_LOADER_CLASS_TYPES) return false; // handled richly above
  return /loader/i.test(classType);
}

// ── Extension (custom_nodes) requirements ───────────────────────────
//
// ComfyUI's API export carries NO record of which extension a node came
// from, so the class_type prefix is the only signal available. Other
// extensions aren't handled yet.

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
