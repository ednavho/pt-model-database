// -------------------------------------------------------------------
// SEAM FOR KYLE'S ComfyUI NODE
//
// Kyle is building a ComfyUI custom node ("PseudoRandomVettedModelLoader"
// or similar) that lets nerds pick a model from the provenance database
// directly inside ComfyUI. When a workflow built with that node is exported
// and dropped into the package-workflow helper tool, the node's class_type
// will appear in this list.
//
// HOW THIS IS USED in the helper tool:
//   1. The parser checks a node's class_type against VETTED_NODE_CLASS_TYPES first.
//   2. If it matches, the node's referenced model is treated as already authoritative-
//      vetted: provenance_id is read directly from the node's stored selection,
//      vetting_status is pulled from the database record, and the "no match" wizard
//      prompt is skipped entirely.
//   3. If it does NOT match, the parser falls back to filename-based matching
//      against the generic loader class_types in GENERIC_LOADER_CLASS_TYPES.
//
// TO INTEGRATE KYLE'S NODE:
//   Once Kyle confirms the real class_type string for his node, just add it to
//   VETTED_NODE_CLASS_TYPES below. No other code needs to change.
//
// The field that carries the model's provenance_id from Kyle's node is expected
// to be a node input named "model_id" (a UUID string). Confirm with Kyle before
// releasing the first version that uses his node.
// -------------------------------------------------------------------

// Add Kyle's node class_type here once confirmed.
export const VETTED_NODE_CLASS_TYPES: string[] = [
  // 'PseudoRandomVettedModelLoader', // <- uncomment and replace with real name
];

// Standard ComfyUI model-loading node class_types used for filename-based matching.
// These are what most exported workflows contain before Kyle's node exists.
export const GENERIC_LOADER_CLASS_TYPES: Record<string, string> = {
  // Checkpoints
  CheckpointLoaderSimple: 'checkpoints',
  CheckpointLoader: 'checkpoints',

  // ControlNet
  ControlNetLoader: 'controlnet',

  // LoRA
  LoraLoader: 'loras',
  LoraLoaderModelOnly: 'loras',

  // VAE
  VAELoader: 'vae',

  // CLIP / Dual Encoders
  CLIPLoader: 'clip',
  DualCLIPLoader: 'clip',

  // UNet / Diffusion Models
  UNETLoader: 'unet',

  // Upscalers
  UpscaleModelLoader: 'upscale_models',
};

// Input field names that hold the filename for each loader class_type.
// Most loaders use "ckpt_name" or "model_name"; this map handles exceptions.
export const LOADER_FILENAME_INPUT: Record<string, string> = {
  CheckpointLoaderSimple: 'ckpt_name',
  CheckpointLoader: 'ckpt_name',
  ControlNetLoader: 'control_net_name',
  LoraLoader: 'lora_name',
  LoraLoaderModelOnly: 'lora_name',
  VAELoader: 'vae_name',
  CLIPLoader: 'clip_name',
  DualCLIPLoader: 'clip_name1',
  UNETLoader: 'unet_name',
  UpscaleModelLoader: 'model_name',
};
