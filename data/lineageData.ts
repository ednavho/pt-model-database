/**
 * Hand-assembled lineage data for the visualisation sketch. Desk research,
 * not a database — nothing here is fetched, and the shape is deliberately
 * loose so the interaction can tell us what the real tables need.
 *
 * `verified: true`  — checked against a real source (arXiv, HuggingFace card).
 * `verified: false` — a plausible placeholder invented to fill out the graph.
 *
 * The community LoRAs are the reason that flag exists: Civitai-style LoRAs
 * almost never document what they were trained atop, so those edges are
 * guesses and must never be presented as fact.
 *
 * WHAT'S IMAGE-SPECIFIC AND WHAT ISN'T
 * Only the `root` nodes and their "requires" edges describe a particular
 * render. Everything below that — where a checkpoint came from, what a CLIP
 * encoder was trained on, who published a paper — is true of the model no
 * matter which image you drop, and is shared across all the example renders.
 */

export type LineageNodeType = 'root' | 'model' | 'dataset' | 'paper' | 'org' | 'person';

export type LineageNode = {
  id: string;
  label: string;
  type: LineageNodeType;
  verified?: boolean;
  source?: string;
};

export type LineageLink = {
  source: string;
  target: string;
  label: string;
  verified: boolean;
};

/**
 * Stand-ins for "an image someone dropped in". Each is a different mix of
 * models, loosely mirroring the shipped pt-essential-workflows, so the sketch
 * can show how the graph changes shape from one render to the next.
 *
 * Nothing reads a real PNG — swapping these is how you preview other images
 * for now.
 */
export const lineageRenders: { id: string; label: string; note: string }[] = [
  { id: 'render_dd', label: 'Dense diffusion', note: 'Juggernaut + depth ControlNet' },
  { id: 'render_ip', label: 'Image prompt', note: 'RealVis + IP-Adapter' },
  { id: 'render_refined', label: 'Refined', note: 'Juggernaut + SDXL refiner pass' },
  { id: 'render_styled', label: 'LoRA styled', note: 'albedobase + two community LoRAs' },
];

export const DEFAULT_RENDER_ID = 'render_dd';

/**
 * Which lineage node each database model corresponds to.
 *
 * This map only exists because the sketch is detached from the database — but
 * it is also the sketch's clearest finding so far: whatever the real tables end
 * up looking like, `models` needs a stable key into the lineage graph, because
 * a filename is not one. All 19 models currently in the database are covered.
 */
export const MODEL_FILE_TO_NODE: Record<string, string> = {
  'Juggernaut_X_RunDiffusion_Hyper.safetensors': 'juggernaut',
  'sd_xl_base_1.0.safetensors': 'sdxl_base',
  'sd_xl_refiner_1.0.safetensors': 'sdxl_refiner',
  'albedobaseXL_v21.safetensors': 'albedobase',
  'realvisxlV50_v50LightningBakedvae.safetensors': 'realvisxl',
  'aiAngelMix_v30.safetensors': 'aiangelmix',
  'control-lora-depth-rank128.safetensors': 'control_lora_depth',
  'diffusion_pytorch_model.safetensors': 'controlnet_generic',
  'CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors': 'clip_bigg',
  'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors': 'clip_h',
  'ip-adapter-plus_sd15.safetensors': 'ipadapter_sd15',
  'ip-adapter-plus_sdxl_vit-h.safetensors': 'ipadapter_sdxl',
  'AlphonseMucha.safetensors': 'AlphonseMucha',
  'Brushstrokes.safetensors': 'Brushstrokes',
  'ColoringBook.safetensors': 'ColoringBook',
  'DelicateWhimsy.safetensors': 'DelicateWhimsy',
  'EldritchCharcoal.safetensors': 'EldritchCharcoal',
  'PixelArt.safetensors': 'PixelArt',
  'SketchIt.safetensors': 'SketchIt',
};

export const lineageNodes: LineageNode[] = [
  // ── Example renders (the only image-specific nodes) ──────────────────────
  { id: "render_dd", label: "Dense diffusion render", type: "root" },
  { id: "render_ip", label: "Image prompt render", type: "root" },
  { id: "render_refined", label: "Refined render", type: "root" },
  { id: "render_styled", label: "LoRA styled render", type: "root" },

  // ── Models ───────────────────────────────────────────────────────────────
  { id: "juggernaut", label: "Juggernaut X Hyper", type: "model", verified: true },
  { id: "control_lora_depth", label: "control-lora-depth", type: "model", verified: true },
  { id: "pseudocomfy", label: "pseudocomfy nodes", type: "model", verified: true },
  { id: "sdxl_base", label: "SD XL base 1.0", type: "model", verified: true },
  { id: "sdxl_refiner", label: "SD XL refiner 1.0", type: "model", verified: true },
  { id: "albedobase", label: "albedobaseXL v21", type: "model", verified: true },
  { id: "realvisxl", label: "realvisxlV50", type: "model", verified: true },
  { id: "aiangelmix", label: "aiAngelMix v30", type: "model", verified: false },
  { id: "clip_bigg", label: "CLIP-ViT-bigG-14", type: "model", verified: true },
  { id: "clip_h", label: "CLIP-ViT-H-14", type: "model", verified: true },
  { id: "clip_vit_l", label: "CLIP ViT-L/14", type: "model", verified: true },
  { id: "controlnet_generic", label: "controlnet (generic)", type: "model", verified: false },
  { id: "ipadapter_sd15", label: "ip-adapter-plus sd15", type: "model", verified: true },
  { id: "ipadapter_sdxl", label: "ip-adapter-plus sdxl", type: "model", verified: true },
  { id: "sd15_base", label: "SD 1.5", type: "model", verified: true },
  { id: "AlphonseMucha", label: "AlphonseMucha", type: "model", verified: false },
  { id: "Brushstrokes", label: "Brushstrokes", type: "model", verified: false },
  { id: "ColoringBook", label: "ColoringBook", type: "model", verified: false },
  { id: "DelicateWhimsy", label: "DelicateWhimsy", type: "model", verified: false },
  { id: "EldritchCharcoal", label: "EldritchCharcoal", type: "model", verified: false },
  { id: "PixelArt", label: "PixelArt", type: "model", verified: false },
  { id: "SketchIt", label: "SketchIt", type: "model", verified: false },

  // ── Datasets ─────────────────────────────────────────────────────────────
  { id: "laion5b", label: "LAION-5B", type: "dataset", verified: true },
  { id: "laion2b", label: "LAION-2B", type: "dataset", verified: true },
  { id: "laion_aesthetics", label: "LAION-Aesthetics v2", type: "dataset", verified: true },
  { id: "midas_ds", label: "MiDaS depth maps", type: "dataset", verified: true },

  // ── Papers ───────────────────────────────────────────────────────────────
  { id: "sdxl_paper", label: "Podell et al., SDXL paper", type: "paper", verified: true, source: "https://arxiv.org/abs/2307.01952" },
  { id: "clip_paper", label: "Radford et al., CLIP", type: "paper", verified: true, source: "https://arxiv.org/abs/2103.00020" },
  { id: "midas_paper", label: "Ranftl et al., depth estimation", type: "paper", verified: true, source: "https://arxiv.org/abs/1907.01341" },
  { id: "controlnet_paper", label: "Zhang et al., ControlNet", type: "paper", verified: true, source: "https://arxiv.org/abs/2302.05543" },
  { id: "ipadapter_paper", label: "Ye et al., IP-Adapter", type: "paper", verified: true, source: "https://arxiv.org/abs/2308.06721" },
  { id: "lora_paper", label: "Hu et al., LoRA", type: "paper", verified: true, source: "https://arxiv.org/abs/2106.09685" },
  { id: "laion5b_paper", label: "Schuhmann et al., LAION-5B", type: "paper", verified: true, source: "https://arxiv.org/abs/2210.08402" },
  { id: "ldm_paper", label: "Rombach et al., Latent Diffusion", type: "paper", verified: true, source: "https://arxiv.org/abs/2112.10752" },

  // ── Organisations ────────────────────────────────────────────────────────
  { id: "org_stability", label: "Stability AI", type: "org", verified: true },
  { id: "org_laion", label: "LAION", type: "org", verified: true },
  { id: "org_openai", label: "OpenAI", type: "org", verified: true },
  { id: "org_rundiffusion", label: "RunDiffusion", type: "org", verified: true },
  { id: "org_tencent", label: "Tencent AI Lab", type: "org", verified: true },
  { id: "org_intel_isl", label: "Intel ISL", type: "org", verified: true },
  { id: "org_microsoft", label: "Microsoft", type: "org", verified: true },
  { id: "org_runway", label: "Runway", type: "org", verified: true },
  { id: "org_compvis", label: "CompVis, LMU Munich", type: "org", verified: true },

  // ── People (paper first authors / published model authors) ───────────────
  { id: "person_podell", label: "Dustin Podell", type: "person", verified: true },
  { id: "person_radford", label: "Alec Radford", type: "person", verified: true },
  { id: "person_zhang", label: "Lvmin Zhang", type: "person", verified: true },
  { id: "person_ye", label: "Hu Ye", type: "person", verified: true },
  { id: "person_hu", label: "Edward J. Hu", type: "person", verified: true },
  { id: "person_ranftl", label: "René Ranftl", type: "person", verified: true },
  { id: "person_schuhmann", label: "Christoph Schuhmann", type: "person", verified: true },
  { id: "person_rombach", label: "Robin Rombach", type: "person", verified: true },
  { id: "person_sg161222", label: "SG_161222", type: "person", verified: true },
];

export const lineageLinks: LineageLink[] = [
  // ── What each example render requires (image-specific) ────────────────────
  { source: "render_dd", target: "juggernaut", label: "requires", verified: true },
  { source: "render_dd", target: "control_lora_depth", label: "requires", verified: true },
  { source: "render_dd", target: "pseudocomfy", label: "requires", verified: true },

  { source: "render_ip", target: "realvisxl", label: "requires", verified: true },
  { source: "render_ip", target: "ipadapter_sdxl", label: "requires", verified: true },
  { source: "render_ip", target: "clip_bigg", label: "requires", verified: true },
  { source: "render_ip", target: "pseudocomfy", label: "requires", verified: true },

  { source: "render_refined", target: "juggernaut", label: "requires", verified: true },
  { source: "render_refined", target: "control_lora_depth", label: "requires", verified: true },
  { source: "render_refined", target: "sdxl_refiner", label: "requires", verified: true },
  { source: "render_refined", target: "pseudocomfy", label: "requires", verified: true },

  { source: "render_styled", target: "albedobase", label: "requires", verified: true },
  { source: "render_styled", target: "AlphonseMucha", label: "requires", verified: true },
  { source: "render_styled", target: "PixelArt", label: "requires", verified: true },
  { source: "render_styled", target: "pseudocomfy", label: "requires", verified: true },

  // ── SDXL family ──────────────────────────────────────────────────────────
  { source: "juggernaut", target: "sdxl_base", label: "fine-tune-of", verified: true },
  { source: "albedobase", target: "sdxl_base", label: "merge-of", verified: true },
  { source: "realvisxl", target: "sdxl_base", label: "merge-of", verified: true },
  { source: "aiangelmix", target: "sdxl_base", label: "merge-of", verified: false },
  { source: "sdxl_refiner", target: "sdxl_base", label: "companion-model", verified: true },
  { source: "sdxl_base", target: "sdxl_paper", label: "described-in", verified: true },
  { source: "sdxl_base", target: "laion5b", label: "trained-on", verified: true },
  { source: "sdxl_base", target: "clip_bigg", label: "uses-encoder", verified: true },
  { source: "sdxl_base", target: "org_stability", label: "released-by", verified: true },
  { source: "sdxl_refiner", target: "org_stability", label: "released-by", verified: true },
  { source: "juggernaut", target: "org_rundiffusion", label: "released-by", verified: true },
  { source: "realvisxl", target: "person_sg161222", label: "released-by", verified: true },

  // ── SD 1.5 lineage ───────────────────────────────────────────────────────
  { source: "sd15_base", target: "ldm_paper", label: "described-in", verified: true },
  { source: "sd15_base", target: "laion_aesthetics", label: "trained-on", verified: true },
  { source: "sd15_base", target: "clip_vit_l", label: "uses-encoder", verified: true },
  { source: "sd15_base", target: "org_runway", label: "released-by", verified: true },

  // ── CLIP encoders ────────────────────────────────────────────────────────
  { source: "clip_bigg", target: "laion2b", label: "trained-on", verified: true },
  { source: "clip_h", target: "laion2b", label: "trained-on", verified: true },
  { source: "clip_bigg", target: "clip_paper", label: "uses-technique-from", verified: true },
  { source: "clip_h", target: "clip_paper", label: "uses-technique-from", verified: true },
  { source: "clip_vit_l", target: "clip_paper", label: "uses-technique-from", verified: true },
  { source: "clip_bigg", target: "org_laion", label: "released-by", verified: true },
  { source: "clip_h", target: "org_laion", label: "released-by", verified: true },
  { source: "clip_vit_l", target: "org_openai", label: "released-by", verified: true },

  // ── ControlNet ───────────────────────────────────────────────────────────
  { source: "control_lora_depth", target: "controlnet_paper", label: "uses-technique-from", verified: true },
  { source: "control_lora_depth", target: "midas_ds", label: "trained-on", verified: true },
  { source: "control_lora_depth", target: "org_stability", label: "released-by", verified: true },
  { source: "controlnet_generic", target: "controlnet_paper", label: "uses-technique-from", verified: true },
  // Which ControlNet this file actually is isn't recorded anywhere, so its
  // base model is a guess.
  { source: "controlnet_generic", target: "sd15_base", label: "built-for", verified: false },
  { source: "midas_ds", target: "midas_paper", label: "described-in", verified: true },

  // ── IP-Adapter ───────────────────────────────────────────────────────────
  { source: "ipadapter_sd15", target: "ipadapter_paper", label: "uses-technique-from", verified: true },
  { source: "ipadapter_sd15", target: "sd15_base", label: "built-for", verified: true },
  { source: "ipadapter_sd15", target: "clip_h", label: "uses-encoder", verified: true },
  { source: "ipadapter_sdxl", target: "ipadapter_paper", label: "uses-technique-from", verified: true },
  { source: "ipadapter_sdxl", target: "sdxl_base", label: "built-for", verified: true },
  { source: "ipadapter_sdxl", target: "clip_bigg", label: "uses-encoder", verified: true },

  // ── Datasets ─────────────────────────────────────────────────────────────
  { source: "laion5b", target: "laion5b_paper", label: "described-in", verified: true },
  { source: "laion5b", target: "org_laion", label: "published-by", verified: true },
  { source: "laion2b", target: "laion5b", label: "subset-of", verified: true },
  { source: "laion_aesthetics", target: "laion5b", label: "filtered-from", verified: true },

  // ── Papers → who wrote them ──────────────────────────────────────────────
  { source: "sdxl_paper", target: "person_podell", label: "first-author", verified: true },
  { source: "sdxl_paper", target: "org_stability", label: "published-by", verified: true },
  { source: "clip_paper", target: "person_radford", label: "first-author", verified: true },
  { source: "clip_paper", target: "org_openai", label: "published-by", verified: true },
  { source: "controlnet_paper", target: "person_zhang", label: "first-author", verified: true },
  { source: "ipadapter_paper", target: "person_ye", label: "first-author", verified: true },
  { source: "ipadapter_paper", target: "org_tencent", label: "published-by", verified: true },
  { source: "midas_paper", target: "person_ranftl", label: "first-author", verified: true },
  { source: "midas_paper", target: "org_intel_isl", label: "published-by", verified: true },
  { source: "lora_paper", target: "person_hu", label: "first-author", verified: true },
  { source: "lora_paper", target: "org_microsoft", label: "published-by", verified: true },
  { source: "laion5b_paper", target: "person_schuhmann", label: "first-author", verified: true },
  { source: "laion5b_paper", target: "org_laion", label: "published-by", verified: true },
  { source: "ldm_paper", target: "person_rombach", label: "first-author", verified: true },
  { source: "ldm_paper", target: "org_compvis", label: "published-by", verified: true },

  // ── Community LoRAs ──────────────────────────────────────────────────────
  // The technique is documented; what they were trained atop is not. Civitai
  // LoRAs rarely record a base model, so every trained-atop edge here is a
  // guess and is flagged as such.
  { source: "AlphonseMucha", target: "lora_paper", label: "uses-technique-from", verified: true },
  { source: "Brushstrokes", target: "lora_paper", label: "uses-technique-from", verified: true },
  { source: "ColoringBook", target: "lora_paper", label: "uses-technique-from", verified: true },
  { source: "DelicateWhimsy", target: "lora_paper", label: "uses-technique-from", verified: true },
  { source: "EldritchCharcoal", target: "lora_paper", label: "uses-technique-from", verified: true },
  { source: "PixelArt", target: "lora_paper", label: "uses-technique-from", verified: true },
  { source: "SketchIt", target: "lora_paper", label: "uses-technique-from", verified: true },
  { source: "AlphonseMucha", target: "sdxl_base", label: "trained-atop", verified: false },
  { source: "Brushstrokes", target: "sdxl_base", label: "trained-atop", verified: false },
  { source: "ColoringBook", target: "sdxl_base", label: "trained-atop", verified: false },
  { source: "DelicateWhimsy", target: "sdxl_base", label: "trained-atop", verified: false },
  { source: "EldritchCharcoal", target: "sdxl_base", label: "trained-atop", verified: false },
  { source: "PixelArt", target: "sdxl_base", label: "trained-atop", verified: false },
  { source: "SketchIt", target: "sdxl_base", label: "trained-atop", verified: false },
];

/**
 * Short, plain-language descriptions shown in the click popup. Not every node
 * needs one — anything missing falls back to a generic line built from its
 * type. Kept terse: one sentence of "what it is".
 */
export const NODE_DESCRIPTIONS: Record<string, string> = {
  juggernaut: "A photorealistic SDXL checkpoint by RunDiffusion, tuned for sharp, high-contrast results.",
  control_lora_depth: "A depth ControlNet: steers the render to follow the 3D geometry of the scene.",
  pseudocomfy: "The Pseudorandom custom ComfyUI nodes that assemble scene data into a render.",
  sdxl_base: "Stability AI's SDXL base model — the foundation most of these checkpoints are built on.",
  sdxl_refiner: "A companion model that sharpens SDXL output in a second pass.",
  albedobase: "A community SDXL merge blending several checkpoints for a balanced look.",
  realvisxl: "A photorealism-focused SDXL merge by SG_161222.",
  aiangelmix: "A community SDXL merge; its exact ancestry isn't documented.",
  clip_bigg: "The larger of SDXL's two text encoders (OpenCLIP ViT-bigG/14).",
  clip_h: "An OpenCLIP ViT-H/14 image/text encoder, used by SD1.5-era IP-Adapters.",
  clip_vit_l: "OpenAI's original CLIP ViT-L/14 encoder, used by SD 1.5.",
  controlnet_generic: "A ControlNet whose exact variant isn't recorded in the file name.",
  ipadapter_sd15: "IP-Adapter for SD 1.5 — conditions a render on a reference image.",
  ipadapter_sdxl: "IP-Adapter for SDXL — conditions a render on a reference image.",
  sd15_base: "Stable Diffusion 1.5, the earlier base model many tools were first built for.",
  laion5b: "A dataset of ~5.8 billion image-text pairs scraped from the web.",
  laion2b: "The English-language subset of LAION-5B, ~2.3 billion pairs.",
  laion_aesthetics: "A LAION subset filtered toward higher aesthetic scores.",
  midas_ds: "Depth maps produced by MiDaS, used to train depth ControlNets.",
  sdxl_paper: "The paper introducing SDXL and its two-stage architecture.",
  clip_paper: "The paper introducing CLIP, the contrastive image-text training method.",
  midas_paper: "The paper behind MiDaS robust monocular depth estimation.",
  controlnet_paper: "The paper introducing ControlNet conditioning for diffusion models.",
  ipadapter_paper: "The paper introducing IP-Adapter image prompting.",
  lora_paper: "The paper introducing LoRA, the low-rank fine-tuning method behind most style adapters.",
  laion5b_paper: "The paper documenting the LAION-5B dataset.",
  ldm_paper: "The latent diffusion paper that Stable Diffusion is built on.",
  org_stability: "The company behind Stable Diffusion and SDXL.",
  org_laion: "The non-profit that assembled the LAION datasets.",
  org_openai: "The lab that published CLIP.",
  org_rundiffusion: "The studio behind the Juggernaut checkpoints.",
  org_tencent: "The lab that published IP-Adapter.",
  org_intel_isl: "Intel's Intelligent Systems Lab, behind MiDaS.",
  org_microsoft: "Microsoft Research, where LoRA originated.",
  org_runway: "The company that released Stable Diffusion 1.5.",
  org_compvis: "The Munich research group behind latent diffusion.",
};

/** How each relationship label reads in a sentence, for the popup. */
export const RELATIONSHIP_PHRASING: Record<string, string> = {
  requires: "is used directly by this render",
  "fine-tune-of": "is a fine-tune of",
  "merge-of": "is a merge of",
  "companion-model": "is a companion to",
  "described-in": "is described in",
  "trained-on": "was trained on",
  "uses-encoder": "uses",
  "uses-technique-from": "uses the technique from",
  "built-for": "was built for",
  "released-by": "was released by",
  "published-by": "was published by",
  "first-author": "was first-authored by",
  "subset-of": "is a subset of",
  "filtered-from": "is filtered from",
  "trained-atop": "was (unconfirmed) trained atop",
};
