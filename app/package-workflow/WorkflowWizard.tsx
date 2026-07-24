'use client';

import {
  COMFY_MODEL_FOLDERS,
  MODEL_FILE_EXTENSIONS,
  PSEUDOCOMFY_REQUIREMENT,
  PSEUDO_CLASS_TYPE_PREFIX,
  PSEUDO_LOAD_MODEL_SNAPSHOT,
  PSEUDO_SEED_NODE,
  PSEUDO_VARIABLE_CLASS_TYPES,
  PSEUDO_VETTED_MODEL_LOADER,
  PSEUDO_UNPACK_MODEL_SNAPSHOT,
  PRESET_LOADER_CLASS_TYPES,
  looksLikeModelLoader,
  SEED_TOKEN,
  SNAPSHOT_NODE_FIELDS,
  SNAPSHOT_SLOT_CAPABILITIES,
  TEMP_PATH_TOKEN,
  VALUE_INPUT_KEYS,
  VETTED_LOADER_FIELDS,
  tokenFromName,
  type VarType,
} from '@/config/pseudoNodeTypes';
import JsonTree from '@/components/ui/JsonTree';
import { ModelDetail } from '@/types/database';
import { cn } from '@/utils/cn';
import { useCallback, useRef, useState } from 'react';

// ── Graph shape ─────────────────────────────────────────────────────────────
//
// Only ComfyUI's "Save (API Format)" export is accepted: a flat map of
// nodeId → node. That's the shape ComfyUI's /prompt endpoint consumes, and
// the graph we embed is handed straight to it at render time — a canvas
// export ("Save") would package cleanly but never run.

type ComfyAPINode = {
  inputs: Record<string, unknown>;
  class_type: string;
  _meta?: { title?: string };
};
type ComfyAPIGraph = Record<string, ComfyAPINode>;

/**
 * A node with accessors that write through to the underlying graph, so
 * cloning and re-wrapping is enough to produce a modified graph.
 */
type Node = {
  id: string;
  class_type: string;
  title: string;
  get: (key: string) => unknown;
  set: (key: string, v: unknown) => void;
  strings: () => { field: string; value: string }[];
  /** Wired inputs — a link is `[sourceNodeId, outputSlot]`. */
  links: () => { field: string; source: string; slot: number }[];
};

function wrap(parsed: unknown): Node[] {
  return Object.entries(parsed as ComfyAPIGraph).map(([id, n]) => ({
    id,
    class_type: n.class_type,
    title: n._meta?.title ?? n.class_type,
    get: (key) => n.inputs?.[key],
    set: (key, v) => {
      if (!n.inputs) n.inputs = {};
      n.inputs[key] = v;
    },
    strings: () =>
      Object.entries(n.inputs ?? {}).flatMap(([k, v]) =>
        typeof v === 'string' ? [{ field: k, value: v }] : []
      ),
    links: () =>
      Object.entries(n.inputs ?? {}).flatMap(([k, v]) =>
        Array.isArray(v) && typeof v[1] === 'number'
          ? [{ field: k, source: String(v[0]), slot: v[1] as number }]
          : []
      ),
  }));
}

/**
 * A canvas export ("Save") has a top-level `nodes` array and `version`;
 * an API export is a bare map of id → node. Telling them apart lets us
 * point the nerd at the right menu item instead of failing vaguely.
 */
function looksLikeCanvasExport(parsed: unknown): boolean {
  const g = parsed as { nodes?: unknown; version?: unknown };
  return Array.isArray(g?.nodes) && typeof g?.version === 'number';
}

function looksLikeApiExport(parsed: unknown): boolean {
  const entries = Object.values(parsed as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every(
    (n) => typeof n === 'object' && n !== null && typeof (n as ComfyAPINode).class_type === 'string'
  );
}

// ── Wizard state types ──────────────────────────────────────────────────────

type ManualProvenance = {
  download_url: string;
  attribution: string;
  attribution_url: string;
  license: string;
  data_provenance_notes: string;
};

const emptyProvenance: ManualProvenance = {
  download_url: '',
  attribution: '',
  attribution_url: '',
  license: '',
  data_provenance_notes: '',
};

/** A model the nerd picked via PseudoVettedModelLoader — authoritative. */
type DbModel = {
  nodeId: string;
  provenanceId: string;
  nameLocal: string;
  fileNameLocal: string;
  categoryLocal: string;
  dbMatch: ModelDetail | null;
};

/**
 * A loader node whose model the scan can't name — either because it picks by
 * preset label ('preset') or because it just looks like a loader but exposes
 * no filename we recognise ('loader'). Flagged so the nerd resolves it by hand
 * rather than it slipping through invisibly.
 */
type UnseenLoader = {
  nodeId: string;
  nodeTitle: string;
  class_type: string;
  kind: 'preset' | 'loader';
  /** The preset label, when kind === 'preset'. */
  preset: string;
  /** Categories the loader is known to pull; empty when unknown. */
  loads: string[];
  note: string;
};

/** A filename-shaped string found by scanning. Needs nerd confirmation. */
type PossibleModel = {
  key: string;
  nodeId: string | null; // null = added by hand
  nodeTitle: string;
  fileName: string;
  category: string;
  selected: boolean;
  provenance: ManualProvenance;
};

type DetectedVariable = {
  nodeId: string;
  class_type: string;
  token: string;
  name: string;
  description: string;
  /** Determined by which PseudoVariable* class_type matched — not editable. */
  type: VarType;
  default: string;
  min: string;
  max: string;
  step: string;
};

type WorkflowAttribution = { author: string; author_url: string; license: string };

type CapabilityFlags = {
  global_guidance_capabilities: {
    txt_scene: boolean;
    txt_style: boolean;
    txt_negative: boolean;
    img_style: boolean;
  };
  regional_guidance_capabilities: { text: boolean; image: boolean };
  spatial_guidance_capabilities: { depth: boolean; edge: boolean };
};

function emptyCapabilities(): CapabilityFlags {
  return {
    global_guidance_capabilities: {
      txt_scene: false,
      txt_style: false,
      txt_negative: false,
      img_style: false,
    },
    regional_guidance_capabilities: { text: false, image: false },
    spatial_guidance_capabilities: { depth: false, edge: false },
  };
}

/**
 * Ticks a capability box for every unpack-snapshot output slot the workflow
 * actually wires somewhere. If the nerd routed env_scene (slot 3) into a node,
 * they're using global txt_scene guidance — so we pre-check it rather than
 * making them re-open ComfyUI to confirm what they already built.
 */
function detectCapabilities(nodes: Node[]): CapabilityFlags {
  const caps = emptyCapabilities();
  const unpack = nodes.find((n) => n.class_type === PSEUDO_UNPACK_MODEL_SNAPSHOT);
  if (!unpack) return caps;

  for (const node of nodes) {
    for (const { source, slot } of node.links()) {
      if (source !== unpack.id) continue;
      const cap = SNAPSHOT_SLOT_CAPABILITIES[slot];
      if (cap) {
        (caps[cap.group as keyof CapabilityFlags] as Record<string, boolean>)[cap.key] = true;
      }
    }
  }
  return caps;
}

type WizardStep =
  | 'upload'
  | 'requirements'
  | 'possible-models'
  | 'variables'
  | 'metadata'
  | 'preview';

type Analysis = {
  nodeCount: number;
  dbModels: DbModel[];
  possibleModels: PossibleModel[];
  unseenLoaders: UnseenLoader[];
  variables: DetectedVariable[];
  /** Node ids of every PseudoSeed. Surfaced as one seed concept, not one each. */
  seedNodeIds: string[];
  snapshotCount: number;
  usesPseudocomfy: boolean;
  /** Capability boxes to pre-check, read from how the snapshot is wired. */
  detectedCaps: CapabilityFlags;
};

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * The nerd-facing name of a Variable node. It lives in the node title
 * (`_meta.title` in API format) — whatever the nerd renamed the node to in
 * ComfyUI. `node.title` already resolves that, falling back to the class_type
 * only when a node has no title at all.
 */
function readVariableName(node: Node): string {
  return node.title.trim();
}

/**
 * The input key a node stores its editable value under. Returns the first
 * candidate that holds a literal (skipping wired inputs, which are arrays);
 * falls back to the first candidate as the write target when none is set.
 */
function valueKeyOf(node: Node): string {
  for (const key of VALUE_INPUT_KEYS) {
    const v = node.get(key);
    if (v !== undefined && !Array.isArray(v) && typeof v !== 'object') return key;
  }
  return VALUE_INPUT_KEYS[0];
}

/** The nerd's test value from ComfyUI, used to pre-fill the wizard's default. */
function readExistingValue(node: Node, type: VarType): string {
  const v = node.get(valueKeyOf(node));
  if (v === null || v === undefined) return type === 'string' ? '' : '0';
  // A linked input is [nodeId, slot] — a wire, not a literal value.
  if (Array.isArray(v)) return type === 'string' ? '' : '0';
  if (typeof v === 'object') return type === 'string' ? '' : '0';
  return String(v);
}

function analyze(parsed: unknown): Analysis {
  const nodes = wrap(parsed);

  const dbModels: DbModel[] = nodes
    .filter((n) => n.class_type === PSEUDO_VETTED_MODEL_LOADER)
    .map((n) => ({
      nodeId: n.id,
      provenanceId: String(n.get(VETTED_LOADER_FIELDS.id) ?? ''),
      nameLocal: String(n.get(VETTED_LOADER_FIELDS.name_local) ?? ''),
      fileNameLocal: String(n.get(VETTED_LOADER_FIELDS.filename_local) ?? ''),
      categoryLocal: String(n.get(VETTED_LOADER_FIELDS.category_local) ?? ''),
      dbMatch: null,
    }));

  // Filenames already accounted for by a vetted loader shouldn't reappear
  // in the speculative scan.
  const claimed = new Set(dbModels.map((m) => m.fileNameLocal.toLowerCase()).filter(Boolean));

  const possibleModels: PossibleModel[] = [];
  const seenFiles = new Set<string>();
  for (const node of nodes) {
    if (node.class_type === PSEUDO_VETTED_MODEL_LOADER) continue;
    for (const { field, value } of node.strings()) {
      const lower = value.toLowerCase();
      if (!MODEL_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue;
      if (claimed.has(lower) || seenFiles.has(lower)) continue;
      seenFiles.add(lower);
      possibleModels.push({
        key: `${node.id}:${field}`,
        nodeId: node.id,
        nodeTitle: node.title,
        fileName: value,
        category: 'checkpoints',
        selected: false,
        provenance: { ...emptyProvenance },
      });
    }
  }

  // Node ids that already contributed a filename to the scan above — a loader
  // that named its file doesn't need flagging.
  const namedByScan = new Set(possibleModels.map((p) => p.nodeId));

  const unseenLoaders: UnseenLoader[] = [];
  for (const n of nodes) {
    if (n.class_type in PRESET_LOADER_CLASS_TYPES) {
      const spec = PRESET_LOADER_CLASS_TYPES[n.class_type];
      const preset = n.get(spec.presetField);
      unseenLoaders.push({
        nodeId: n.id,
        nodeTitle: n.title,
        class_type: n.class_type,
        kind: 'preset',
        preset: typeof preset === 'string' ? preset : '',
        loads: [...spec.loads],
        note: spec.note,
      });
    } else if (looksLikeModelLoader(n.class_type) && !namedByScan.has(n.id)) {
      unseenLoaders.push({
        nodeId: n.id,
        nodeTitle: n.title,
        class_type: n.class_type,
        kind: 'loader',
        preset: '',
        loads: [],
        note: 'Looks like a model loader, but no filename appears in the graph — add the model it loads by hand.',
      });
    }
  }

  const variables: DetectedVariable[] = nodes
    .filter((n) => n.class_type in PSEUDO_VARIABLE_CLASS_TYPES)
    .map((n) => {
      // The matched class_type IS the type — there's no type field to read.
      const type = PSEUDO_VARIABLE_CLASS_TYPES[n.class_type];
      const name = readVariableName(n);
      return {
        nodeId: n.id,
        class_type: n.class_type,
        token: tokenFromName(name),
        name,
        description: '',
        type,
        default: readExistingValue(n, type),
        min: '0',
        max: '1',
        step: type === 'int' ? '1' : '0.05',
      };
    });

  return {
    nodeCount: nodes.length,
    dbModels,
    possibleModels,
    unseenLoaders,
    variables,
    seedNodeIds: nodes.filter((n) => n.class_type === PSEUDO_SEED_NODE).map((n) => n.id),
    snapshotCount: nodes.filter((n) => n.class_type === PSEUDO_LOAD_MODEL_SNAPSHOT).length,
    usesPseudocomfy: nodes.some((n) => n.class_type.startsWith(PSEUDO_CLASS_TYPE_PREFIX)),
    detectedCaps: detectCapabilities(nodes),
  };
}

/**
 * Writes the reserved tokens into a copy of the graph. The token becomes the
 * entire value of the node's own field; downstream links are untouched and
 * carry the resolved value at render time.
 */
function buildWorkflowGraph(rawGraph: unknown, variables: DetectedVariable[]): unknown {
  const clone = structuredClone(rawGraph);
  const nodes = wrap(clone);

  for (const node of nodes) {
    if (node.class_type in PSEUDO_VARIABLE_CLASS_TYPES) {
      const v = variables.find((x) => x.nodeId === node.id);
      if (v) node.set(valueKeyOf(node), v.token);
    } else if (node.class_type === PSEUDO_SEED_NODE) {
      // Every seed node gets the same token — the plugin drives one seed.
      node.set(valueKeyOf(node), SEED_TOKEN);
    } else if (node.class_type === PSEUDO_LOAD_MODEL_SNAPSHOT) {
      node.set(SNAPSHOT_NODE_FIELDS.path, TEMP_PATH_TOKEN);
    }
  }

  return clone;
}

function validateVariables(vars: DetectedVariable[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const v of vars) {
    if (!v.name.trim()) {
      errors.push(`A variable on node ${v.nodeId} has no name. Every variable needs one.`);
      continue;
    }
    if (seen.has(v.token)) {
      errors.push(
        `Two variables both resolve to ${v.token}. Give them distinct names.`
      );
    }
    seen.add(v.token);
  }

  return errors;
}

// ── Shared styles ───────────────────────────────────────────────────────────

const inputClass =
  'block w-full border border-zinc-300 rounded-sm px-3 py-2 text-sm text-zinc-900 bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400';
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-1';

/**
 * Hover/focus hint explaining a field. Focusable so it's reachable by
 * keyboard, and labelled so screen readers get the text without the tooltip
 * ever being shown.
 */
function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={text}
        onClick={(e) => e.preventDefault()}
        className="text-zinc-300 hover:text-zinc-500 focus:text-zinc-500 focus:outline-none"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M8 7.25v3.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <circle cx="8" cy="5.1" r="0.8" fill="currentColor" />
        </svg>
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-20 mb-1.5 w-max max-w-56 -translate-x-1/2 rounded-sm bg-zinc-900 px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug tracking-normal text-white opacity-0 shadow-sm transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

/**
 * A field label with an optional hover hint. The icon is a sibling of the
 * label rather than a child: a label stretches the full width of its column,
 * so nesting the icon inside would make the whole row part of its hover area.
 */
function FieldLabel({
  children,
  tip,
  plain,
}: {
  children: React.ReactNode;
  tip?: string;
  /** Heading for a group of controls rather than a label for one input. */
  plain?: boolean;
}) {
  const Text = plain ? 'p' : 'label';
  return (
    <span className="mb-1 flex items-center gap-1">
      <Text className={cn(labelClass, 'mb-0')}>{children}</Text>
      {tip && <InfoTip text={tip} />}
    </span>
  );
}

/** One row of capability checkboxes under a heading that explains the group. */
function CapabilityGroup({
  title,
  tip,
  flags,
  onToggle,
}: {
  title: string;
  tip: string;
  flags: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  return (
    <div>
      <FieldLabel plain tip={tip}>
        {title}
      </FieldLabel>
      <div className="flex flex-wrap gap-3">
        {Object.keys(flags).map((key) => (
          <label
            key={key}
            className="flex cursor-pointer items-center gap-1.5 text-sm text-zinc-700"
          >
            <input type="checkbox" checked={flags[key]} onChange={() => onToggle(key)} />
            {key}
          </label>
        ))}
      </div>
    </div>
  );
}

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'requirements', label: 'Models' },
  { key: 'possible-models', label: 'Other Models' },
  { key: 'variables', label: 'Variables' },
  { key: 'metadata', label: 'Metadata' },
  { key: 'preview', label: 'Preview' },
];

function StepIndicator({ current }: { current: WizardStep }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((step, i) => (
        <div key={step.key} className="flex items-center">
          <div
            className={cn(
              'w-6 h-6 rounded-full border flex items-center justify-center text-xs font-semibold',
              i < currentIdx
                ? 'bg-zinc-900 border-zinc-900 text-white'
                : i === currentIdx
                ? 'border-zinc-900 text-zinc-900'
                : 'border-zinc-200 text-zinc-300'
            )}
          >
            {i + 1}
          </div>
          <span
            className={cn(
              'ml-2 text-xs',
              i === currentIdx ? 'text-zinc-900 font-medium' : 'text-zinc-400'
            )}
          >
            {step.label}
          </span>
          {i < STEPS.length - 1 && (
            <div className={cn('mx-2 h-px w-8', i < currentIdx ? 'bg-zinc-900' : 'bg-zinc-200')} />
          )}
        </div>
      ))}
    </div>
  );
}

function ProvenanceFields({
  value,
  onChange,
}: {
  value: ManualProvenance;
  onChange: (field: keyof ManualProvenance, v: string) => void;
}) {
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <div>
        <FieldLabel tip="Direct link to the model file itself. The plugin uses this to fetch the model when someone is missing it.">Download URL</FieldLabel>
        <input
          className={inputClass}
          value={value.download_url}
          onChange={(e) => onChange('download_url', e.target.value)}
          placeholder="https://huggingface.co/…"
        />
      </div>
      <div>
        <FieldLabel tip="The licence the model is released under, e.g. CreativeML Open RAIL-M. Tells people what they are allowed to do with what they make.">License</FieldLabel>
        <input
          className={inputClass}
          value={value.license}
          onChange={(e) => onChange('license', e.target.value)}
          placeholder="e.g. Apache 2.0"
        />
      </div>
      <div>
        <FieldLabel tip="Who made the model. Shown as the credit line to anyone using this workflow.">Attribution</FieldLabel>
        <input
          className={inputClass}
          value={value.attribution}
          onChange={(e) => onChange('attribution', e.target.value)}
          placeholder="Creator or org"
        />
      </div>
      <div>
        <FieldLabel tip="Link to the model's original page or its author, so the credit can be followed back to the source.">Attribution URL</FieldLabel>
        <input
          className={inputClass}
          value={value.attribution_url}
          onChange={(e) => onChange('attribution_url', e.target.value)}
          placeholder="https://…"
        />
      </div>
      <div className="md:col-span-2">
        <FieldLabel tip="What the model was trained on, and anything known about its dataset, lineage, or licensing concerns.">Data Provenance Notes</FieldLabel>
        <textarea
          className={cn(inputClass, 'min-h-[60px] resize-y')}
          value={value.data_provenance_notes}
          onChange={(e) => onChange('data_provenance_notes', e.target.value)}
          placeholder="Training data, known issues, lineage…"
        />
      </div>
    </div>
  );
}

// ── Main wizard ─────────────────────────────────────────────────────────────

export default function WorkflowWizard() {
  const [step, setStep] = useState<WizardStep>('upload');
  const [rawGraph, setRawGraph] = useState<unknown>(null);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [blockingError, setBlockingError] = useState<string | null>(null);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);

  const [nodeCount, setNodeCount] = useState(0);
  const [dbModels, setDbModels] = useState<DbModel[]>([]);
  const [possibleModels, setPossibleModels] = useState<PossibleModel[]>([]);
  const [unseenLoaders, setUnseenLoaders] = useState<UnseenLoader[]>([]);
  const [variables, setVariables] = useState<DetectedVariable[]>([]);
  const [seedNodeIds, setSeedNodeIds] = useState<string[]>([]);
  const [usesPseudocomfy, setUsesPseudocomfy] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const [workflowName, setWorkflowName] = useState('');
  const [description, setDescription] = useState('');
  const [thumbnailDataUri, setThumbnailDataUri] = useState('');
  const [attribution, setAttribution] = useState<WorkflowAttribution>({
    author: '',
    author_url: '',
    license: '',
  });
  const [caps, setCaps] = useState<CapabilityFlags>(emptyCapabilities);
  // True once we pre-check boxes from the graph — surfaced to the nerd so they
  // know why things are already ticked.
  const [capsAutoDetected, setCapsAutoDetected] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // ── Step 1: Upload ────────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    setParseError(null);
    setBlockingError(null);
    setUploadWarnings([]);
    setRawGraph(null);
    setUploadedFileName(file.name);

    try {
      const parsed = JSON.parse(await file.text());
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Expected a ComfyUI workflow JSON file.');
      }

      if (looksLikeCanvasExport(parsed)) {
        setBlockingError(
          'This is a canvas export — the file ComfyUI saves so you can keep editing the workflow. It records node positions and wiring, but not the runnable graph, so a workflow packaged from it would never render. In ComfyUI use Workflow → Export (API) instead, then upload that file.'
        );
        return;
      }
      if (!looksLikeApiExport(parsed)) {
        setBlockingError(
          "This doesn't look like a ComfyUI API export. Expected a JSON object mapping node ids to nodes, each with a class_type. In ComfyUI use Workflow → Export (API)."
        );
        return;
      }

      const a = analyze(parsed);

      // Without a snapshot loader the workflow can't receive scene data from
      // Rhino, so it could never render. That's the only hard stop.
      if (a.snapshotCount === 0) {
        setBlockingError(
          `No ${PSEUDO_LOAD_MODEL_SNAPSHOT} node found. It's what receives the scene data from Rhino at render time, so the workflow can't run without it. Add one in ComfyUI and re-upload.`
        );
        return;
      }

      const warnings: string[] = [];
      if (a.snapshotCount > 1) {
        warnings.push(
          `Found ${a.snapshotCount} ${PSEUDO_LOAD_MODEL_SNAPSHOT} nodes, but there should be exactly one. Only one will receive scene data — remove the extras.`
        );
      }
      if (a.seedNodeIds.length === 0) {
        warnings.push(
          `No ${PSEUDO_SEED_NODE} node found. The workflow will still render, but the seed is fixed at whatever the graph already holds — nobody using it in the plugin will be able to reroll and get a different image.`
        );
      }
      // Zero Variable nodes is normal — it just means nothing is adjustable.

      setRawGraph(parsed);
      setNodeCount(a.nodeCount);
      setDbModels(a.dbModels);
      setPossibleModels(a.possibleModels);
      setUnseenLoaders(a.unseenLoaders);
      setVariables(a.variables);
      setSeedNodeIds(a.seedNodeIds);
      setUsesPseudocomfy(a.usesPseudocomfy);
      setCaps(a.detectedCaps);
      setCapsAutoDetected(
        Object.values(a.detectedCaps).some((group) =>
          Object.values(group as Record<string, boolean>).some(Boolean)
        )
      );
      setUploadWarnings(warnings);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to parse JSON.');
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleContinueFromUpload = async () => {
    if (!rawGraph) return;
    setMatchLoading(true);
    try {
      const ids = [...new Set(dbModels.map((m) => m.provenanceId).filter(Boolean))];
      const results = await Promise.all(
        ids.map((id) => fetch(`/api/models/${id}`).then((r) => (r.ok ? r.json() : null)))
      );
      const byId = new Map<string, ModelDetail>(
        (results.filter(Boolean) as ModelDetail[]).map((d) => [d.id, d])
      );
      setDbModels((prev) =>
        prev.map((m) => ({ ...m, dbMatch: byId.get(m.provenanceId) ?? null }))
      );
    } finally {
      setMatchLoading(false);
    }
    setStep('requirements');
  };

  // ── Step 3: Possible models ───────────────────────────────────────────────

  const updatePossible = <K extends keyof PossibleModel>(
    key: string,
    field: K,
    value: PossibleModel[K]
  ) => {
    setPossibleModels((prev) =>
      prev.map((p) => (p.key === key ? { ...p, [field]: value } : p))
    );
  };

  const updatePossibleProvenance = (
    key: string,
    field: keyof ManualProvenance,
    value: string
  ) => {
    setPossibleModels((prev) =>
      prev.map((p) =>
        p.key === key ? { ...p, provenance: { ...p.provenance, [field]: value } } : p
      )
    );
  };

  const addManualModel = (category = 'checkpoints', label = 'Added by hand') => {
    setPossibleModels((prev) => [
      ...prev,
      {
        key: `manual:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        nodeId: null,
        nodeTitle: label,
        fileName: '',
        category,
        selected: true,
        provenance: { ...emptyProvenance },
      },
    ]);
  };

  // ── Step 4: Variables ─────────────────────────────────────────────────────

  const updateVar = <K extends keyof DetectedVariable>(
    idx: number,
    field: K,
    value: DetectedVariable[K]
  ) => {
    setVariables((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      // Name drives the token — keep them in sync.
      if (field === 'name') next[idx].token = tokenFromName(String(value));
      return next;
    });
  };

  const handleContinueFromVariables = () => {
    const errors = validateVariables(variables);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);
    setStep('metadata');
  };

  // ── Step 5: Metadata ──────────────────────────────────────────────────────

  const handleThumbChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setThumbnailDataUri(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const toggleCap = (group: keyof CapabilityFlags, key: string) => {
    setCaps((prev) => ({
      ...prev,
      [group]: {
        ...(prev[group] as Record<string, boolean>),
        [key]: !(prev[group] as Record<string, boolean>)[key],
      },
    }));
  };

  // ── Step 6: Assemble output ───────────────────────────────────────────────

  const buildOutput = () => {
    const fromManual = (p: ManualProvenance) => {
      const out: Record<string, unknown> = {};
      if (p.download_url) out.download_url = p.download_url;
      if (p.attribution) out.attribution = p.attribution;
      if (p.attribution_url) out.attribution_url = p.attribution_url;
      if (p.license) out.license = p.license;
      if (p.data_provenance_notes) out.data_provenance_notes = p.data_provenance_notes;
      return out;
    };

    // Every requirement gets the same shape: the pointer when we have one, and
    // a frozen copy of the provenance as the offline fallback.
    const dbRequirements = dbModels.map((m) => {
      const d = m.dbMatch;
      const provenance: Record<string, unknown> = {};
      if (d) {
        if (d.download_url) provenance.download_url = d.download_url;
        if (d.attribution) provenance.attribution = d.attribution;
        if (d.attribution_url) provenance.attribution_url = d.attribution_url;
        if (d.license) provenance.license = d.license;
        if (d.data_provenance_notes) provenance.data_provenance_notes = d.data_provenance_notes;
        if (d.size_bytes) provenance.size_bytes = d.size_bytes;
      }
      return {
        category: (d?.category ?? m.categoryLocal).toLowerCase(),
        requirement: d?.file_name ?? m.fileNameLocal,
        provenance_id: m.provenanceId || null,
        // The DB stores these Title Case; the workflow schema wants slugs.
        vetting_status: (d?.vetting_status ?? 'unknown').toLowerCase(),
        ...(Object.keys(provenance).length > 0 ? { provenance } : {}),
      };
    });

    const scannedRequirements = possibleModels
      .filter((p) => p.selected && p.fileName.trim())
      .map((p) => {
        const provenance = fromManual(p.provenance);
        return {
          category: p.category,
          requirement: p.fileName.trim(),
          provenance_id: null,
          vetting_status: 'unknown',
          ...(Object.keys(provenance).length > 0 ? { provenance } : {}),
        };
      });

    // Shape and key order follow the shipped pseudorandom workflows: name,
    // type, description, default, binds_to, then min/max/step for numerics.
    const variablesDef = variables.map((v) => {
      const isNumeric = v.type === 'int' || v.type === 'float';
      return {
        name: v.name,
        type: v.type,
        description: v.description,
        default: isNumeric ? (isNaN(Number(v.default)) ? 0 : Number(v.default)) : v.default,
        binds_to: v.token,
        ...(isNumeric && {
          min: isNaN(Number(v.min)) ? 0 : Number(v.min),
          max: isNaN(Number(v.max)) ? 1 : Number(v.max),
          step: isNaN(Number(v.step)) ? (v.type === 'int' ? 1 : 0.05) : Number(v.step),
        }),
      };
    });

    return {
      pseudorandom_workflow_schema_version: 0.3,
      type: 'comfy',
      name: workflowName,
      description,
      thumbnail: thumbnailDataUri || null,
      attribution: {
        author: attribution.author || null,
        author_url: attribution.author_url || null,
        license: attribution.license || null,
      },
      ...caps,
      variables: variablesDef,
      endpoint_requirements: [
        ...dbRequirements,
        ...scannedRequirements,
        ...(usesPseudocomfy ? [PSEUDOCOMFY_REQUIREMENT] : []),
      ],
      workflow: buildWorkflowGraph(rawGraph, variables),
    };
  };

  const downloadOutput = () => {
    const errors = validateVariables(variables);
    if (errors.length > 0) {
      setValidationErrors(errors);
      setStep('variables');
      return;
    }
    const blob = new Blob([JSON.stringify(buildOutput(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(workflowName || 'workflow').replace(/\s+/g, '_').toLowerCase()}.pseudorandom.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedCount = possibleModels.filter((p) => p.selected).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <StepIndicator current={step} />

      {/* ── Step 1: Upload ─────────────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="space-y-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-sm p-12 text-center cursor-pointer transition-colors',
              isDragging ? 'border-zinc-400 bg-zinc-50' : 'border-zinc-200 hover:border-zinc-300'
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileChange}
            />
            {uploadedFileName ? (
              <div>
                <p className="font-medium text-zinc-900">{uploadedFileName}</p>
                <p className="text-xs text-zinc-400 mt-1">Click to replace</p>
              </div>
            ) : (
              <div>
                <p className="text-zinc-500 mb-1">Drag and drop a ComfyUI workflow JSON file</p>
                <p className="text-xs text-zinc-400">or click to browse</p>
                <p className="text-xs text-zinc-400 mt-3">
                  Must be an API export — in ComfyUI, Workflow → Export (API)
                </p>
              </div>
            )}
          </div>

          {parseError && (
            <div className="border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-sm">
              {parseError}
            </div>
          )}

          {blockingError && (
            <div className="border border-red-200 bg-red-50 rounded-sm px-4 py-3">
              <p className="text-xs font-semibold text-red-700 mb-1">
                This workflow can&apos;t be packaged
              </p>
              <p className="text-sm text-red-700">{blockingError}</p>
            </div>
          )}

          {uploadWarnings.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-sm px-4 py-3">
              <p className="text-xs font-semibold text-amber-800 mb-1">Worth a look</p>
              <ul className="list-disc list-inside space-y-0.5">
                {uploadWarnings.map((w, i) => (
                  <li key={i} className="text-sm text-amber-800">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rawGraph !== null && (
            <div className="border border-zinc-200 rounded-sm px-4 py-3 text-sm text-zinc-600">
              Parsed <strong>{nodeCount}</strong> nodes. Found{' '}
              <strong>{dbModels.length}</strong> database model(s),{' '}
              <strong>{possibleModels.length}</strong> possible model file(s),{' '}
              {unseenLoaders.length > 0 && (
                <>
                  <strong>{unseenLoaders.length}</strong> loader(s) the scan can&apos;t name,{' '}
                </>
              )}
              <strong>{variables.length}</strong> variable(s) and{' '}
              <strong>{seedNodeIds.length}</strong> seed node(s).
            </div>
          )}

          <div className="flex justify-end">
            <button
              disabled={rawGraph === null || matchLoading}
              onClick={handleContinueFromUpload}
              className="border border-zinc-300 rounded-sm px-6 py-2 text-sm font-medium text-zinc-900 bg-white hover:bg-zinc-50 disabled:opacity-40 transition-colors"
            >
              {matchLoading ? 'Looking up models…' : 'Continue →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Database models ────────────────────────────────────── */}
      {step === 'requirements' && (
        <div className="space-y-6">
          <div className="border border-zinc-200 rounded-sm p-5">
            <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500 mb-1">
              Models From The Database
            </div>
            <p className="text-xs text-zinc-400 mb-4">
              Picked in ComfyUI via {PSEUDO_VETTED_MODEL_LOADER}. Provenance comes from the
              database record.
            </p>

            {dbModels.length === 0 ? (
              <p className="text-sm text-zinc-400">
                No {PSEUDO_VETTED_MODEL_LOADER} nodes in this workflow. Any models it uses will
                show up on the next step.
              </p>
            ) : (
              <div className="space-y-4">
                {dbModels.map((m) => (
                  <div key={m.nodeId} className="border border-zinc-100 rounded-sm p-4">
                    <div className="mb-3">
                      <p className="font-medium text-sm text-zinc-900">
                        {m.dbMatch?.name ?? (m.nameLocal || m.fileNameLocal)}
                      </p>
                      <p className="text-xs text-zinc-400 font-mono">
                        {m.dbMatch?.file_name ?? m.fileNameLocal}
                      </p>
                    </div>

                    {m.dbMatch ? (
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-zinc-500">
                        <span>
                          Category:{' '}
                          <strong className="text-zinc-700">{m.dbMatch.category}</strong>
                        </span>
                        <span>
                          Status:{' '}
                          <strong className="text-zinc-700">{m.dbMatch.vetting_status}</strong>
                        </span>
                        <span>
                          License:{' '}
                          <strong className="text-zinc-700">{m.dbMatch.license ?? '—'}</strong>
                        </span>
                        <span>
                          Attribution:{' '}
                          <strong className="text-zinc-700">{m.dbMatch.attribution ?? '—'}</strong>
                        </span>
                        <span className="col-span-2 font-mono text-zinc-400 text-[10px] mt-1">
                          provenance_id: {m.dbMatch.id}
                        </span>
                      </div>
                    ) : (
                      <div className="border border-amber-200 bg-amber-50 rounded-sm px-3 py-2">
                        <p className="text-xs text-amber-800">
                          The node points at{' '}
                          <code className="font-mono">{m.provenanceId || '(no id)'}</code>, but
                          that record isn&apos;t in the database right now. The workflow will fall
                          back to the node&apos;s local values:{' '}
                          <strong>{m.fileNameLocal || '—'}</strong> ({m.categoryLocal || '—'}).
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep('upload')}
              className="border border-zinc-200 rounded-sm px-5 py-2 text-sm text-zinc-500 hover:bg-zinc-50"
            >
              ← Back
            </button>
            <button
              onClick={() => setStep('possible-models')}
              className="border border-zinc-300 rounded-sm px-6 py-2 text-sm font-medium text-zinc-900 bg-white hover:bg-zinc-50 transition-colors"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Possible models ────────────────────────────────────── */}
      {step === 'possible-models' && (
        <div className="space-y-6">
          <div className="border border-zinc-200 rounded-sm p-5">
            <div className="flex items-start justify-between gap-4 mb-1">
              <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500">
                Other Possible Models
              </div>
              <button
                onClick={() => addManualModel()}
                className="text-xs border border-zinc-200 rounded-sm px-3 py-1 text-zinc-600 hover:border-zinc-400 transition-colors shrink-0"
              >
                + Add a model by hand
              </button>
            </div>
            <p className="text-xs text-zinc-400 mb-4">
              Found by scanning every node for filename-shaped strings, so this list is a guess —
              tick the ones that are really model requirements. If something is missing, add it by
              hand.
            </p>

            {unseenLoaders.length > 0 && (
              <div className="border border-amber-200 bg-amber-50 rounded-sm p-4 mb-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-amber-800">
                    Models the scan can&apos;t see
                  </p>
                  <p className="text-xs text-amber-800 mt-1">
                    These are loader nodes with no filename in the workflow — either they pick a
                    model by preset name, or we don&apos;t recognise how they name it. They still
                    need to be listed as requirements, so add each one by hand below.
                  </p>
                </div>
                {unseenLoaders.map((ul) => (
                  <div key={ul.nodeId} className="border border-amber-200 bg-white rounded-sm p-3">
                    <p className="text-sm text-zinc-900">
                      {ul.nodeTitle}{' '}
                      <span className="text-xs text-zinc-400">
                        · node {ul.nodeId} · <code className="font-mono">{ul.class_type}</code>
                      </span>
                    </p>
                    {ul.preset && (
                      <p className="text-xs text-zinc-500 mt-0.5">
                        preset: <code className="font-mono">{ul.preset}</code>
                      </p>
                    )}
                    <p className="text-xs text-zinc-500 mt-1">{ul.note}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {ul.loads.length > 0 ? (
                        ul.loads.map((cat) => (
                          <button
                            key={cat}
                            onClick={() => addManualModel(cat, `For ${ul.nodeTitle} (node ${ul.nodeId})`)}
                            className="text-xs border border-zinc-300 rounded-sm px-2.5 py-1 text-zinc-700 bg-white hover:bg-zinc-50 transition-colors"
                          >
                            + Add {cat} model
                          </button>
                        ))
                      ) : (
                        <button
                          onClick={() => addManualModel('checkpoints', `For ${ul.nodeTitle} (node ${ul.nodeId})`)}
                          className="text-xs border border-zinc-300 rounded-sm px-2.5 py-1 text-zinc-700 bg-white hover:bg-zinc-50 transition-colors"
                        >
                          + Add the model this node loads
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {possibleModels.length === 0 ? (
              <p className="text-sm text-zinc-400">
                No model-shaped filenames found
                {unseenLoaders.length > 0 ? ' beyond the ones flagged above' : ''}. If this workflow
                needs a model that isn&apos;t already listed, add it by hand.
              </p>
            ) : (
              <div className="space-y-4">
                {possibleModels.map((p) => (
                  <div
                    key={p.key}
                    className={cn(
                      'border rounded-sm p-4 transition-colors',
                      p.selected ? 'border-zinc-300 bg-white' : 'border-zinc-100 bg-zinc-50/50'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={p.selected}
                        onChange={(e) => updatePossible(p.key, 'selected', e.target.checked)}
                        className="mt-1 shrink-0"
                        id={`sel_${p.key}`}
                      />
                      <div className="flex-1 min-w-0">
                        {p.nodeId === null ? (
                          <div>
                            <input
                              className={inputClass}
                              value={p.fileName}
                              onChange={(e) => updatePossible(p.key, 'fileName', e.target.value)}
                              placeholder="filename.safetensors"
                            />
                            <p className="text-xs text-zinc-400 mt-1">{p.nodeTitle}</p>
                          </div>
                        ) : (
                          <label htmlFor={`sel_${p.key}`} className="cursor-pointer block">
                            <p className="font-mono text-sm text-zinc-900 break-all">
                              {p.fileName}
                            </p>
                            <p className="text-xs text-zinc-400">{p.nodeTitle}</p>
                          </label>
                        )}
                      </div>
                    </div>

                    {p.selected && (
                      <div className="mt-4 pl-6 space-y-3">
                        <div className="max-w-xs">
                          <FieldLabel tip="Which ComfyUI models/ subfolder this file belongs in. Determines where the plugin puts it on disk.">Category</FieldLabel>
                          <select
                            className={inputClass}
                            value={p.category}
                            onChange={(e) => updatePossible(p.key, 'category', e.target.value)}
                          >
                            {COMFY_MODEL_FOLDERS.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </div>
                        <p className="text-xs text-zinc-400">
                          Provenance — fill in whatever you know. All fields optional.
                        </p>
                        <ProvenanceFields
                          value={p.provenance}
                          onChange={(field, v) => updatePossibleProvenance(p.key, field, v)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep('requirements')}
              className="border border-zinc-200 rounded-sm px-5 py-2 text-sm text-zinc-500 hover:bg-zinc-50"
            >
              ← Back
            </button>
            <button
              onClick={() => setStep('variables')}
              className="border border-zinc-300 rounded-sm px-6 py-2 text-sm font-medium text-zinc-900 bg-white hover:bg-zinc-50 transition-colors"
            >
              Continue with {selectedCount} selected →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Variables ──────────────────────────────────────────── */}
      {step === 'variables' && (
        <div className="space-y-6">
          <div className="border border-zinc-200 rounded-sm p-5">
            <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500 mb-4">
              Variables
            </div>

            {validationErrors.length > 0 && (
              <div className="border border-red-200 bg-red-50 rounded-sm p-3 mb-4">
                <p className="text-xs font-semibold text-red-700 mb-1">
                  Fix these before continuing:
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  {validationErrors.map((e, i) => (
                    <li key={i} className="text-xs text-red-700">
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {variables.length === 0 ? (
              <p className="text-sm text-zinc-400">
                No Variable nodes in this workflow, so nothing will be adjustable from the plugin.
                That&apos;s fine — add {Object.keys(PSEUDO_VARIABLE_CLASS_TYPES).join(', ')} nodes
                in ComfyUI and re-upload if that isn&apos;t what you want.
              </p>
            ) : (
              <div className="space-y-6">
                {variables.map((v, idx) => (
                  <div key={v.nodeId} className="border border-zinc-100 rounded-sm p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <code className="font-mono text-xs bg-zinc-100 px-2 py-0.5 rounded">
                        {v.token || '(needs a name)'}
                      </code>
                      <span className="text-xs border border-zinc-200 text-zinc-500 px-1.5 py-0.5 rounded-sm">
                        {v.type}
                      </span>
                      <span className="text-xs text-zinc-400">
                        from node {v.nodeId} · {v.class_type}
                      </span>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <FieldLabel tip="What this control is called in the Rhino plugin. Also generates the binds_to token that links it back to the node.">Variable Name</FieldLabel>
                        <input
                          className={inputClass}
                          value={v.name}
                          onChange={(e) => updateVar(idx, 'name', e.target.value)}
                          placeholder="e.g. Adherence"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <FieldLabel tip="A short line telling someone what this control actually changes about the image.">Description</FieldLabel>
                        <input
                          className={inputClass}
                          value={v.description}
                          onChange={(e) => updateVar(idx, 'description', e.target.value)}
                          placeholder="Shown to the user in the Rhino plugin"
                        />
                      </div>
                      <div>
                        <FieldLabel tip="The value used when nobody touches the control. Pre-filled with whatever you left in the ComfyUI graph.">Default</FieldLabel>
                        <input
                          className={inputClass}
                          value={v.default}
                          onChange={(e) => updateVar(idx, 'default', e.target.value)}
                        />
                      </div>
                      {(v.type === 'int' || v.type === 'float') && (
                        <>
                          <div>
                            <FieldLabel tip="Lowest value the control will allow.">Min</FieldLabel>
                            <input
                              className={inputClass}
                              value={v.min}
                              onChange={(e) => updateVar(idx, 'min', e.target.value)}
                            />
                          </div>
                          <div>
                            <FieldLabel tip="Highest value the control will allow.">Max</FieldLabel>
                            <input
                              className={inputClass}
                              value={v.max}
                              onChange={(e) => updateVar(idx, 'max', e.target.value)}
                            />
                          </div>
                          <div>
                            <FieldLabel tip="How far the value jumps each time the control is nudged.">Step</FieldLabel>
                            <input
                              className={inputClass}
                              value={v.step}
                              onChange={(e) => updateVar(idx, 'step', e.target.value)}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Seeds are detected and tokenized, but aren't user-configurable and
              don't appear in the output's variables[] list. */}
          <div className="border border-zinc-200 rounded-sm p-5">
            <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500 mb-1">
              Seeds
            </div>
            <p className="text-xs text-zinc-400 mb-4">
              Handled automatically — the plugin drives the seed. It isn&apos;t listed as a
              variable and has no binds_to.
            </p>
            {seedNodeIds.length === 0 ? (
              <div className="border border-amber-200 bg-amber-50 rounded-sm px-3 py-2">
                <p className="text-xs text-amber-800">
                  {`No ${PSEUDO_SEED_NODE} node in this workflow. It will still render, but the seed stays fixed at whatever the graph already holds — every run produces the same image, and nobody using this workflow in the plugin can reroll it. Add one in ComfyUI and re-upload if that isn't what you want.`}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <code className="font-mono text-xs bg-zinc-100 px-2 py-0.5 rounded">
                  {SEED_TOKEN}
                </code>
                <span className="text-xs text-zinc-400">
                  {seedNodeIds.length === 1
                    ? `node ${seedNodeIds[0]}`
                    : `${seedNodeIds.length} nodes (${seedNodeIds.join(', ')}) — all driven together`}
                </span>
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep('possible-models')}
              className="border border-zinc-200 rounded-sm px-5 py-2 text-sm text-zinc-500 hover:bg-zinc-50"
            >
              ← Back
            </button>
            <button
              onClick={handleContinueFromVariables}
              className="border border-zinc-300 rounded-sm px-6 py-2 text-sm font-medium text-zinc-900 bg-white hover:bg-zinc-50 transition-colors"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 5: Metadata ───────────────────────────────────────────── */}
      {step === 'metadata' && (
        <div className="space-y-6">
          <div className="border border-zinc-200 rounded-sm p-5 space-y-5">
            <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500">
              Workflow Info
            </div>
            <div>
              <FieldLabel tip="How this workflow is listed in the Rhino plugin. Also becomes the download filename.">Workflow Name *</FieldLabel>
              <input
                className={inputClass}
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                placeholder="e.g. Juggernaut Essential"
                required
              />
            </div>
            <div>
              <FieldLabel tip="What this workflow is for and the kind of images it makes. Shown when choosing between workflows.">Description</FieldLabel>
              <textarea
                className={cn(inputClass, 'min-h-[80px] resize-y')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this workflow do? What is it good for?"
              />
            </div>
            <div>
              <FieldLabel tip="A sample render showing what this workflow produces. Shown as its preview when picking a workflow.">Thumbnail</FieldLabel>
              <input
                ref={thumbInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleThumbChange}
              />
              <div className="flex items-center gap-4">
                {thumbnailDataUri && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbnailDataUri}
                    alt="Thumbnail preview"
                    className="w-20 h-20 object-cover rounded-sm border border-zinc-200"
                  />
                )}
                <button
                  type="button"
                  onClick={() => thumbInputRef.current?.click()}
                  className="text-sm border border-zinc-200 rounded-sm px-3 py-1.5 text-zinc-600 hover:border-zinc-400 transition-colors"
                >
                  {thumbnailDataUri ? 'Replace image' : 'Upload image'}
                </button>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Will be embedded as a base64 data URI in the output file.
              </p>
            </div>
          </div>

          <div className="border border-zinc-200 rounded-sm p-5 space-y-4">
            <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500">
              Workflow Attribution
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <FieldLabel tip="Who built this workflow. Credited to anyone who uses it.">Author</FieldLabel>
                <input
                  className={inputClass}
                  value={attribution.author}
                  onChange={(e) => setAttribution((a) => ({ ...a, author: e.target.value }))}
                />
              </div>
              <div>
                <FieldLabel tip="Link to the author's site or profile.">Author URL</FieldLabel>
                <input
                  className={inputClass}
                  type="url"
                  value={attribution.author_url}
                  onChange={(e) => setAttribution((a) => ({ ...a, author_url: e.target.value }))}
                />
              </div>
              <div>
                <FieldLabel tip="How other people may use and share this workflow.">License</FieldLabel>
                <input
                  className={inputClass}
                  value={attribution.license}
                  onChange={(e) => setAttribution((a) => ({ ...a, license: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="border border-zinc-200 rounded-sm p-5 space-y-4">
            <div>
              <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500">
                Capability Flags
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                {capsAutoDetected
                  ? 'Pre-checked from how your workflow is wired — each box below is ticked because the matching snapshot output is connected in your ComfyUI graph. Adjust any that look wrong.'
                  : 'These describe what kinds of guidance the workflow supports. We check them automatically from how the snapshot is wired, but none were detected here — tick whatever applies.'}
              </p>
            </div>

            <CapabilityGroup
              title="Global Guidance"
              tip="Guidance that applies to the whole image at once."
              flags={caps.global_guidance_capabilities}
              onToggle={(key) => toggleCap('global_guidance_capabilities', key)}
            />

            <CapabilityGroup
              title="Regional Guidance"
              tip="Guidance aimed at individual materials or regions of the model rather than the whole image."
              flags={caps.regional_guidance_capabilities}
              onToggle={(key) => toggleCap('regional_guidance_capabilities', key)}
            />

            <CapabilityGroup
              title="Spatial Guidance"
              tip="Guidance read from the 3D geometry itself, so the render follows the model."
              flags={caps.spatial_guidance_capabilities}
              onToggle={(key) => toggleCap('spatial_guidance_capabilities', key)}
            />
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep('variables')}
              className="border border-zinc-200 rounded-sm px-5 py-2 text-sm text-zinc-500 hover:bg-zinc-50"
            >
              ← Back
            </button>
            <button
              disabled={!workflowName}
              onClick={() => setStep('preview')}
              className="border border-zinc-300 rounded-sm px-6 py-2 text-sm font-medium text-zinc-900 bg-white hover:bg-zinc-50 disabled:opacity-40 transition-colors"
            >
              Preview Output →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 6: Preview & Download ─────────────────────────────────── */}
      {step === 'preview' && (
        <div className="space-y-6">
          <div className="border border-zinc-200 rounded-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500">
                Output Preview
              </div>
              <button
                onClick={downloadOutput}
                className="border border-zinc-300 rounded-sm px-4 py-1.5 text-sm font-medium text-zinc-900 bg-white hover:bg-zinc-50 transition-colors"
              >
                Download .pseudorandom.json
              </button>
            </div>
            <JsonTree data={buildOutput()} maxHeight={560} />
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep('metadata')}
              className="border border-zinc-200 rounded-sm px-5 py-2 text-sm text-zinc-500 hover:bg-zinc-50"
            >
              ← Back
            </button>
            <button
              onClick={downloadOutput}
              className="border border-zinc-900 bg-zinc-900 text-white rounded-sm px-6 py-2 text-sm font-medium hover:bg-zinc-800 transition-colors"
            >
              Download .pseudorandom.json
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
