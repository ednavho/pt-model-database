'use client';

import React from 'react';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import {
  COMFY_MODEL_FOLDERS,
  MODEL_FILE_EXTENSIONS,
  PSEUDOCOMFY_REQUIREMENT,
  PSEUDO_CLASS_TYPE_PREFIX,
  PSEUDO_LOAD_MODEL_SNAPSHOT,
  PSEUDO_SEED_NODE,
  PSEUDO_VARIABLE_CLASS_TYPES,
  VETTED_LOADER_CLASS_TYPES,
  PSEUDO_UNPACK_MODEL_SNAPSHOT,
  PRESET_LOADER_CLASS_TYPES,
  looksLikeModelLoader,
  SEED_TOKEN,
  SNAPSHOT_NODE_FIELDS,
  SNAPSHOT_SLOT_CAPABILITIES,
  TEMP_PATH_TOKEN,
  VALUE_INPUT_KEYS,
  tokenFromName,
  type VarType,
  type ComfyModelFolder,
} from '@/config/pseudoNodeTypes';
import JsonTree from '@/components/ui/JsonTree';
import RiskBadge from '@/components/ui/RiskBadge';
import { EMPTY_PROVENANCE, type ModelCardRecord } from '@/lib/modelCards';
import { cn } from '@/utils/cn';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

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

type AlertMessage = { title: string; message: string };

/**
 * Provenance fields collected by hand for a model that isn't in the
 * database — deliberately a smaller set than ModelProvenance: no
 * reviewer/reviewed_at/license_findings/evidence/rationale/risk scores,
 * since none of that review data exists for a model nobody has vetted.
 */
type ManualProvenance = {
  download_url: string;
  size_bytes: string;
  license_id: string;
  license_url: string;
  attribution_name: string;
  attribution_url: string;
};

const emptyProvenance: ManualProvenance = {
  download_url: '',
  size_bytes: '',
  license_id: '',
  license_url: '',
  attribution_name: '',
  attribution_url: '',
};

/** A model the nerd picked via PseudoVettedModelLoader — authoritative. */
type DbModel = {
  nodeId: string;
  class_type: string;
  recordId: string;
  nameLocal: string;
  modelIdLocal: string;
  fileNameLocal: string;
  categoryLocal: string;
  dbMatch: ModelCardRecord | null;
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
  forLoaderNodeId?: string | null;
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

/**
 * Sensible starting min/max/step for a numeric variable — fixed, intuitive
 * ranges rather than scaling off the detected default. These are just
 * starting points the nerd can overwrite.
 */
function suggestRange(type: VarType): { min: string; max: string; step: string } {
  if (type === 'int') return { min: '0', max: '100', step: '1' };
  return { min: '0', max: '10', step: '0.1' };
}

/**
 * Best-effort category guess for a scan-detected possible model, from the
 * input field name (most reliable — ComfyUI loader nodes follow fairly
 * consistent naming, e.g. `lora_name`, `vae_name`) and falling back to the
 * node's class_type. Order matters: more specific needles (e.g.
 * "clip_vision") must be checked before substrings they contain ("clip").
 * Defaults to 'checkpoints' when nothing matches — the previous behavior.
 */
function guessPossibleModelCategory(field: string, classType: string): ComfyModelFolder {
  const haystack = `${field} ${classType}`.toLowerCase();
  const rules: [string, ComfyModelFolder][] = [
    ['clip_vision', 'clip_vision'],
    ['clipvision', 'clip_vision'],
    ['ipadapter', 'ipadapter'],
    ['ip_adapter', 'ipadapter'],
    ['control_net', 'controlnet'],
    ['controlnet', 'controlnet'],
    ['lora', 'loras'],
    ['vae_approx', 'vae_approx'],
    ['vae', 'vae'],
    ['upscale', 'upscale_models'],
    ['style_model', 'style_models'],
    ['unet', 'unet'],
    ['clip', 'clip'],
    ['ckpt', 'checkpoints'],
    ['checkpoint', 'checkpoints'],
  ];
  for (const [needle, category] of rules) {
    if (haystack.includes(needle)) return category;
  }
  return 'checkpoints';
}

function analyze(parsed: unknown): Analysis {
  const nodes = wrap(parsed);

  const dbModels: DbModel[] = nodes
    .filter((n) => n.class_type in VETTED_LOADER_CLASS_TYPES)
    .map((n) => {
      const spec = VETTED_LOADER_CLASS_TYPES[n.class_type];
      return {
        nodeId: n.id,
        class_type: n.class_type,
        recordId: '',
        nameLocal: '',
        modelIdLocal: String(n.get('model_id') ?? ''),
        fileNameLocal: String(n.get(spec.filenameField) ?? ''),
        categoryLocal: spec.category,
        dbMatch: null,
      };
    });

  // Filenames already accounted for by a vetted loader shouldn't reappear
  // in the speculative scan.
  const claimed = new Set(dbModels.map((m) => m.fileNameLocal.toLowerCase()).filter(Boolean));

  const possibleModels: PossibleModel[] = [];
  const seenFiles = new Set<string>();
  for (const node of nodes) {
    if (node.class_type in VETTED_LOADER_CLASS_TYPES) continue;
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
        category: guessPossibleModelCategory(field, node.class_type),
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
      const defaultValue = readExistingValue(n, type);
      const { min, max, step } = suggestRange(type);
      return {
        nodeId: n.id,
        class_type: n.class_type,
        token: tokenFromName(name),
        name,
        description: '',
        type,
        default: defaultValue,
        min,
        max,
        step,
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
  { key: 'requirements', label: 'Database Models' },
  { key: 'possible-models', label: 'Possible models' },
  { key: 'variables', label: 'Variables' },
  { key: 'metadata', label: 'Metadata' },
  { key: 'preview', label: 'Preview' },
];

function UploadAlert({ kind, title, message }: { kind: 'warning' | 'error'; title: string; message: string }) {
  return (
    <div className={cn(
      'flex items-center gap-3 rounded-[8px] px-4 py-3 border',
      kind === 'error'
        ? 'bg-[#FFF5F5] border-[#FECACA]'
        : 'bg-[#FFFBEB] border-[#FDE68A]'
    )}>
      <div className="shrink-0">
        {kind === 'error' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#DC2626" strokeWidth="1.5" />
            <path d="M12 8v5" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="12" cy="16.5" r="0.75" fill="#DC2626" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#D97706" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M12 9v4" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="12" cy="17" r="0.75" fill="#D97706" />
          </svg>
        )}
      </div>
      <div>
        <p className={cn('text-[13px] font-semibold', kind === 'error' ? 'text-[#DC2626]' : 'text-amber-800')}>
          {title}
        </p>
        <p className={cn('text-[13px] mt-0.5', kind === 'error' ? 'text-[#DC2626]' : 'text-amber-800')}>
          {message}
        </p>
      </div>
    </div>
  );
}

function HamburgerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

function CodePreview({ code }: { code: string }) {
  const lines = code.split('\n');
  return (
    <div className="flex font-mono text-[11px] leading-[18px]">
      <div className="select-none text-right pr-4 pl-4 pt-4 pb-4 text-[#C8C8C8]" style={{ minWidth: '3rem' }}>
        {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <pre className="flex-1 text-[#666] pt-4 pb-4 pr-4 whitespace-pre overflow-x-auto">{code}</pre>
    </div>
  );
}

const CARD_INPUT = 'w-full border border-[#E9E9E9] rounded-[8px] px-3 py-2 text-[13px] outline-none focus:border-[#B0B0B0] bg-white placeholder:text-[#B0B0B0]';
const CARD_LABEL = 'flex items-center gap-1.5 text-[12px] text-[#939393] mb-1';
const META_INPUT = 'w-full border-b border-[#E9E9E9] py-1.5 text-[13px] outline-none focus:border-b-black bg-transparent';
const META_LABEL = 'flex items-center gap-1.5 text-[12px] text-[#939393] mb-1';

const LOADER_CAT_LABELS: Record<string, string> = {
  checkpoints: 'Checkpoint',
  controlnet: 'ControlNet',
  loras: 'LoRA',
  clip_vision: 'Clip Vision',
  ipadapter: 'IPAdapter',
};

const CAP_LABELS: Record<string, { name: string; type?: string }> = {
  txt_scene: { name: 'Scene', type: 'text' },
  txt_style: { name: 'Style', type: 'text' },
  txt_negative: { name: 'Negative', type: 'text' },
  img_style: { name: 'Style', type: 'image' },
  text: { name: 'Text' },
  image: { name: 'Image' },
  depth: { name: 'Depth' },
  edge: { name: 'Edge' },
};

function SelectInput({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { className?: string }) {
  return (
    <div className="relative">
      <select className={cn(className, 'appearance-none pr-8')} {...props} />
      <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#939393]">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 4.5L6 8L9.5 4.5" />
        </svg>
      </div>
    </div>
  );
}

// ── Diff ────────────────────────────────────────────────────────────────────

type DiffLine = { type: 'same' | 'add' | 'remove'; text: string };

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
      result.unshift({ type: 'same', text: a[i-1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      result.unshift({ type: 'add', text: b[j-1] }); j--;
    } else {
      result.unshift({ type: 'remove', text: a[i-1] }); i--;
    }
  }
  return result;
}

// ── Main wizard ─────────────────────────────────────────────────────────────

export default function WorkflowWizard() {
  const [step, setStep] = useState<WizardStep>('upload');
  const [rawGraph, setRawGraph] = useState<unknown>(null);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [blockingError, setBlockingError] = useState<AlertMessage | null>(null);
  const [uploadWarnings, setUploadWarnings] = useState<AlertMessage[]>([]);

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

  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // null = not yet manually resized, so the panel just flexes to fill
  // whatever space the (max-width-capped) middle column leaves behind.
  // Once the user drags the handle, this becomes a fixed pixel width.
  const [rightPanelWidth, setRightPanelWidth] = useState<number | null>(null);
  const [panelMinimized, setPanelMinimized] = useState(false);
  const panelDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const baselineRef = useRef<string | null>(null);
  const codeScrollRef = useRef<HTMLDivElement>(null);
  const codeLineRefs = useRef<Array<HTMLDivElement | null>>([]);

  const handlePanelDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startWidth = rightPanelRef.current?.getBoundingClientRect().width ?? rightPanelWidth ?? 380;
    panelDragRef.current = { startX: e.clientX, startWidth };
    const onMove = (ev: MouseEvent) => {
      if (!panelDragRef.current) return;
      const delta = panelDragRef.current.startX - ev.clientX;
      setRightPanelWidth(Math.max(200, Math.min(700, panelDragRef.current.startWidth + delta)));
    };
    const onUp = () => {
      panelDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

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
        setBlockingError({
          title: 'Invalid File',
          message: 'Canvas export detected. Use Workflow → Export (API) in ComfyUI.',
        });
        return;
      }
      if (!looksLikeApiExport(parsed)) {
        setBlockingError({
          title: 'Invalid File',
          message: 'Not a ComfyUI API export. Use Workflow → Export (API) in ComfyUI.',
        });
        return;
      }

      const a = analyze(parsed);

      // Without a snapshot loader the workflow can't receive scene data from
      // Rhino, so it could never render. That's the only hard stop.
      if (a.snapshotCount === 0) {
        setBlockingError({
          title: 'Missing Node',
          message: `No ${PSEUDO_LOAD_MODEL_SNAPSHOT} node found.`,
        });
        return;
      }

      const warnings: AlertMessage[] = [];
      if (a.snapshotCount > 1) {
        warnings.push({
          title: 'Warning',
          message: `Found ${a.snapshotCount} ${PSEUDO_LOAD_MODEL_SNAPSHOT} nodes, expected 1.`,
        });
      }
      if (a.seedNodeIds.length === 0) {
        warnings.push({
          title: 'Missing Node',
          message: `No ${PSEUDO_SEED_NODE} node found.`,
        });
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
      // Look up each model: by record_id first (the pointer, authoritative),
      // filename as fallback. model_id is now a Hugging Face repo path
      // (e.g. "pseudotools/checkpoint-juggernaut-x-hyper"); the fallback
      // searches by requirement (the card's filename field) when that
      // pointer is missing.
      const updatedDbModels = await Promise.all(
        dbModels.map(async (m) => {
          if (m.modelIdLocal) {
            const path = m.modelIdLocal.split('/').map(encodeURIComponent).join('/');
            const r = await fetch(`/api/models/hf/${path}`);
            if (r.ok) {
              const d: ModelCardRecord = await r.json();
              return { ...m, dbMatch: d, recordId: d.record_id };
            }
          }
          if (m.fileNameLocal) {
            const r = await fetch(`/api/models/hf/by-filename/${encodeURIComponent(m.fileNameLocal)}`);
            if (r.ok) {
              const d: ModelCardRecord = await r.json();
              return { ...m, dbMatch: d, recordId: d.record_id };
            }
          }
          return { ...m, dbMatch: null };
        })
      );
      setDbModels(updatedDbModels);
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

  const addManualModel = (category = 'checkpoints', forLoaderNodeId: string | null = null) => {
    setPossibleModels((prev) => [
      {
        key: `manual:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        nodeId: null,
        nodeTitle: '',
        fileName: '',
        category,
        selected: true,
        provenance: { ...emptyProvenance },
        forLoaderNodeId,
      },
      ...prev,
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
    // A requirement matched against the database (vetted) carries the full
    // 14-key provenance object, verbatim from the matched card — reusing
    // ModelProvenance means this and the pseudorandom model provenance API
    // response are always the same shape by construction, not by
    // convention. A requirement added by hand (not vetted) never had that
    // review data collected, so it gets the smaller 6-key provenance
    // instead, per the schema Kyle and Edna settled on.
    const provenanceFromManual = (p: ManualProvenance) => ({
      download_url: p.download_url || null,
      size_bytes: p.size_bytes.trim() ? Number(p.size_bytes) || null : null,
      license_id: p.license_id || null,
      license_url: p.license_url || null,
      attribution_name: p.attribution_name || null,
      attribution_url: p.attribution_url || null,
    });

    // Every requirement gets the same shape: the pointer when we have one, and
    // a frozen copy of the provenance as the offline fallback.
    const dbRequirements = dbModels.map((m) => {
      const d = m.dbMatch;
      return {
        display_name: d?.display_name || m.fileNameLocal,
        // m.categoryLocal (ComfyUI folder name, e.g. "checkpoints") rather
        // than d?.category (the card's own singular label, e.g.
        // "checkpoint") — this is what determines where the file lands on
        // disk, so it needs to stay consistent whether or not the DB match
        // succeeded. Worth confirming this is the right call.
        category: m.categoryLocal.toLowerCase(),
        requirement: d?.requirement ?? m.fileNameLocal,
        record_id: m.recordId || null,
        provenance: d?.provenance ?? EMPTY_PROVENANCE,
      };
    });

    const scannedRequirements = possibleModels
      .filter((p) => p.selected && p.fileName.trim())
      .map((p) => ({
        display_name: p.fileName.trim(),
        category: p.category,
        requirement: p.fileName.trim(),
        provenance: provenanceFromManual(p.provenance),
      }));

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

  // Capture baseline output the first time a file is loaded (before the user fills any fields)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (rawGraph !== null && baselineRef.current === null) {
      baselineRef.current = JSON.stringify(buildOutput(), null, 2);
    }
  }, [rawGraph]);

  const currentOutputStr = useMemo(
    () => rawGraph !== null ? JSON.stringify(buildOutput(), null, 2) : '',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workflowName, description, thumbnailDataUri, attribution, caps, variables, dbModels, possibleModels, rawGraph, usesPseudocomfy]
  );

  const diffResult = useMemo(
    () => baselineRef.current ? computeDiff(baselineRef.current, currentOutputStr) : null,
    [currentOutputStr]
  );

  const diffAdded = useMemo(() => diffResult?.filter(l => l.type === 'add').length ?? 0, [diffResult]);
  const diffRemoved = useMemo(() => diffResult?.filter(l => l.type === 'remove').length ?? 0, [diffResult]);

  // Given the line index of a requirement object's display_name (always
  // its first key, one line below the object's opening brace), returns
  // the line range worth bringing into view: the span of lines that
  // actually changed from baseline within that object, so a big
  // mostly-unchanged provenance blob doesn't drag the scroll target past
  // what's actually visible. Falls back to just the anchor line if
  // nothing in the object changed (e.g. it already matched baseline).
  const findChangedBlockRange = (diffLines: DiffLine[], anchorIdx: number) => {
    const openIdx = anchorIdx - 1;
    let depth = 0;
    let closeIdx = diffLines.length - 1;
    for (let i = openIdx; i < diffLines.length; i++) {
      for (const ch of diffLines[i].text) {
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') depth--;
      }
      if (depth === 0) { closeIdx = i; break; }
    }
    let start = -1, end = -1;
    for (let i = openIdx; i <= closeIdx; i++) {
      if (diffLines[i].type !== 'same') {
        if (start === -1) start = i;
        end = i;
      }
    }
    return start === -1 ? { start: anchorIdx, end: anchorIdx } : { start, end };
  };

  // Which line range of the code panel this step is "about", so switching
  // steps can scroll the panel to the part of the document that step
  // edits — the db-match requirement, the first checked possible model,
  // or the variables array.
  const codeScrollTarget = useMemo(() => {
    if (!diffResult) return null;
    const lines = diffResult.map((l) => l.text);

    if (step === 'requirements' && dbModels.length > 0) {
      const m = dbModels[0];
      const marker = `"display_name": ${JSON.stringify(m.dbMatch?.display_name || m.fileNameLocal)}`;
      const idx = lines.findIndex((l) => l.includes(marker));
      return idx === -1 ? null : findChangedBlockRange(diffResult, idx);
    }

    if (step === 'possible-models') {
      const first = possibleModels.find((p) => p.selected && p.fileName.trim());
      if (!first) return null;
      const marker = `"display_name": ${JSON.stringify(first.fileName.trim())}`;
      const idx = lines.findIndex((l) => l.includes(marker));
      return idx === -1 ? null : findChangedBlockRange(diffResult, idx);
    }

    if (step === 'variables') {
      const idx = lines.findIndex((l) => l.trim().startsWith('"variables":'));
      return idx === -1 ? null : { start: idx, end: idx };
    }

    // Metadata edits (name, description, thumbnail, attribution) all land
    // in the first few lines of the document, so there's no specific line
    // to hunt for — just surface the top of the file.
    if (step === 'metadata') {
      return lines.length > 0 ? { start: 0, end: 0 } : null;
    }

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, diffResult, dbModels, possibleModels]);

  // Gently eases the code panel to the target range rather than jumping —
  // a plain scrollIntoView can't be given a duration/easing, so this
  // animates scrollTop by hand. Top-aligns the range with some breathing
  // room when it fits the panel; when it's taller than the panel, still
  // starts from the top of the range (where the change begins matters
  // more than its unchanged tail) but trims the padding to fit more of it.
  useEffect(() => {
    if (!codeScrollTarget) return;
    const container = codeScrollRef.current;
    const startEl = codeLineRefs.current[codeScrollTarget.start];
    const endEl = codeLineRefs.current[codeScrollTarget.end];
    if (!container || !startEl || !endEl) return;

    const containerTop = container.getBoundingClientRect().top;
    const startTop = startEl.getBoundingClientRect().top - containerTop + container.scrollTop;
    const endBottom = endEl.getBoundingClientRect().bottom - containerTop + container.scrollTop;

    const topPadding = 24;
    const blockFits = endBottom - startTop + topPadding + 16 <= container.clientHeight;
    const desiredScrollTop = Math.max(0, startTop - (blockFits ? topPadding : 8));

    const startScrollTop = container.scrollTop;
    const distance = desiredScrollTop - startScrollTop;
    if (Math.abs(distance) < 2) return;

    const duration = 700;
    const startTime = performance.now();
    const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    let rafId: number;
    const animate = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      container.scrollTop = startScrollTop + distance * easeInOutCubic(t);
      if (t < 1) rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [codeScrollTarget]);

  const outputFileName = `${(workflowName || uploadedFileName?.replace(/\.json$/, '') || 'workflow').replace(/\s+/g, '_').toLowerCase()}.pseudorandom.json`;

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
  const currentIdx = STEPS.findIndex((s) => s.key === step);

  const resetUpload = useCallback(() => {
    setUploadedFileName('');
    setRawGraph(null);
    setParseError(null);
    setBlockingError(null);
    setUploadWarnings([]);
    setNodeCount(0);
    setDbModels([]);
    setPossibleModels([]);
    setUnseenLoaders([]);
    setVariables([]);
    setSeedNodeIds([]);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)]">
      {/* Full-width Workflow Converter title */}
      <div className="shrink-0 px-6 pt-8 pb-4">
        <p className="text-[15px] font-semibold text-black">Workflow Converter</p>
      </div>

      {/* Three-column row — all top-aligned */}
      <div className="flex flex-1 min-h-0 overflow-hidden pt-4">

      {/* Left sidebar */}
      <aside className="w-[200px] shrink-0 px-6 pb-8 overflow-y-auto">
        <div className="space-y-4">
          {STEPS.map((s, i) => {
            const completed = i < currentIdx;
            return (
              <div
                key={s.key}
                className={cn('flex items-center gap-3', completed && 'cursor-pointer hover:opacity-60 transition-opacity')}
                onClick={completed ? () => setStep(s.key) : undefined}
                role={completed ? 'button' : undefined}
                tabIndex={completed ? 0 : undefined}
                onKeyDown={completed ? (e) => e.key === 'Enter' && setStep(s.key) : undefined}
              >
                <div className={cn(
                  'w-6 h-6 rounded-full border flex items-center justify-center text-[11px] font-semibold shrink-0',
                  completed
                    ? 'bg-black border-black text-white'
                    : i === currentIdx
                    ? 'border-black text-black'
                    : 'border-[#D4D4D4] text-[#B0B0B0]'
                )}>
                  {i + 1}
                </div>
                <span className={cn(
                  'text-[13px]',
                  i === currentIdx ? 'text-black' : completed ? 'text-black' : 'text-[#939393]'
                )}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Content area */}
      <div className="flex flex-1 min-w-0 overflow-hidden">
        {/* Main content column — capped at its own max content width (800px)
            instead of flex-1, so it doesn't stretch to a 50/50 split with the
            code panel; the code panel fills whatever space is left over. */}
        <div className="relative flex flex-col min-w-0 overflow-hidden" style={{ flex: '0 1 800px' }}>
        {/* Scrollable content */}
        <div className={step === 'preview' ? 'flex-1 overflow-hidden flex flex-col min-h-0' : 'flex-1 overflow-y-auto'}>
          <div className={step === 'preview' ? 'flex-1 flex flex-col min-h-0 px-10 max-w-[800px]' : 'px-10 pb-[100px] max-w-[800px]'}>

      {/* ── Step 1: Upload ─────────────────────────────────────────────── */}
      {step === 'upload' && (
        <div>
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'relative border border-dashed rounded-[8px] cursor-pointer transition-colors flex items-center justify-center min-h-[280px]',
              isDragging ? 'border-[#B0B0B0] bg-zinc-50' : 'border-[#D4D4D4] hover:border-[#B0B0B0]'
            )}
          >
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileChange} />
            {uploadedFileName ? (
              <div className="text-center">
                <p className="text-[15px] font-medium text-black">{uploadedFileName}</p>
                <p className="text-[13px] text-[#939393] mt-1">click to replace</p>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <p className="text-[15px] text-black">Select a ComfyUI json to upload</p>
                  <p className="text-[13px] text-[#939393] mt-2">or drag and drop it here</p>
                </div>
                <p className="absolute bottom-10 left-0 right-0 text-center text-[13px] text-[#C0C0C0]">(Must be an API export)</p>
              </>
            )}
          </div>

          {/* Status messages */}
          <div className="mt-4 space-y-3">
            {parseError && (
              <UploadAlert kind="error" title="Invalid File" message={parseError} />
            )}
            {blockingError && (
              <UploadAlert kind="error" title={blockingError.title} message={blockingError.message} />
            )}
            {uploadWarnings.map((w, i) => (
              <UploadAlert key={i} kind="warning" title={w.title} message={w.message} />
            ))}
            {rawGraph !== null && (
              <div className="text-[13px] text-black pl-2">
                <p className="font-medium mb-2">Parsed {nodeCount} nodes and found:</p>
                <div className="space-y-0.5">
                  <p className="text-[#939393]">{dbModels.length} database model{dbModels.length !== 1 ? 's' : ''}</p>
                  <p className="text-[#939393]">{possibleModels.length} possible model{possibleModels.length !== 1 ? 's' : ''}</p>
                  <p className="text-[#939393]">{variables.length} variable{variables.length !== 1 ? 's' : ''}</p>
                  <p className="text-[#939393]">{seedNodeIds.length} seed</p>
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── Step 2: Database models ────────────────────────────────────── */}
      {step === 'requirements' && (
        <div>
          <div className="space-y-4">
            {dbModels.length === 0 ? (
              <p className="text-[13px] text-[#939393]">
                No vetted model loader nodes found in this workflow.
              </p>
            ) : (
              dbModels.map((m) => (
                <div key={m.nodeId} className="border border-[#E9E9E9] rounded-[8px] p-5">
                  <p className="text-[15px] font-semibold text-black">
                    {m.dbMatch?.display_name ?? (m.fileNameLocal || `(${m.class_type})`)}
                  </p>
                  <p className="text-[12px] text-[#939393] font-mono mt-0.5">
                    {m.dbMatch?.requirement ?? m.fileNameLocal}
                  </p>

                  {m.dbMatch ? (
                    // All four columns flex equally (flex-1 min-w-0) — this also solves
                    // cross-card alignment architecturally rather than via a min-width
                    // hack: equal flex-1 columns are the same width on every card by
                    // construction, since they're sized off the row's available width,
                    // not off each card's own content. min-w-0 is required, not
                    // decorative — a flex item's default min-width is its content's
                    // intrinsic width, which silently blocks shrinking below that and
                    // is what caused the row to overflow/get cut off at narrower
                    // window widths otherwise. Gap is 32px (down from 64px) — Category
                    // stays put and Status/License/Attribution shift left with it.
                    <div className="mt-4 flex items-start gap-[32px] w-full">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-[#939393] mb-1">Category</p>
                        <p className="text-[13px] text-black capitalize">{m.dbMatch.category}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-[#939393] mb-1">Status</p>
                        <RiskBadge record={m.dbMatch} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-[#939393] mb-1">License</p>
                        <p className="text-[13px] text-black">{m.dbMatch.provenance.license_id ?? '—'}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-[#939393] mb-1">Attribution</p>
                        <p className="text-[13px] text-black">{m.dbMatch.provenance.attribution_name ?? '—'}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <UploadAlert kind="warning" title="Missing model" message="No model selected for this loader." />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

        </div>
      )}

      {/* ── Step 3: Possible models ────────────────────────────────────── */}
      {step === 'possible-models' && (
        <div>
          {(unseenLoaders.length > 0 || possibleModels.length > 0) && (
            <div className="flex items-center justify-end mb-4">
              <button
                onClick={() => addManualModel('checkpoints', null)}
                className="shrink-0 border border-[#E9E9E9] bg-white rounded-[8px] px-3 py-1.5 text-[13px] text-black hover:border-[#B0B0B0] transition-colors whitespace-nowrap"
              >
                + Add Model
              </button>
            </div>
          )}
          <div className="space-y-4">
            {/* Manually added models not tied to a specific unseen loader */}
            {possibleModels.filter((p) => p.nodeId === null && !p.forLoaderNodeId).map((p) => (
              <div
                key={p.key}
                className={cn('border rounded-[8px] p-5 transition-colors', p.selected ? 'border-black' : 'border-[#E9E9E9]')}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={p.selected}
                    onChange={(e) => updatePossible(p.key, 'selected', e.target.checked)}
                    className="mt-1 shrink-0 w-4 h-4 accent-black cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    {!p.selected && (
                      <p
                        className="text-[15px] font-semibold text-black cursor-pointer transition-colors hover:text-[#939393]"
                        onClick={() => updatePossible(p.key, 'selected', !p.selected)}
                      >
                        {p.fileName || 'New model'}
                      </p>
                    )}
                    {p.selected && (
                      <div className="space-y-4">
                        <div>
                          <label className={CARD_LABEL}><span>File name<span className="text-red-500 ml-px">*</span></span> <InfoTooltip text="The model filename as referenced in the workflow graph" /></label>
                          <input className={CARD_INPUT} value={p.fileName} onChange={(e) => updatePossible(p.key, 'fileName', e.target.value)} placeholder="filename.safetensors" />
                        </div>
                        <div>
                          <label className={CARD_LABEL}><span>Category<span className="text-red-500 ml-px">*</span></span> <InfoTooltip text="The ComfyUI subfolder where this model is stored" /></label>
                          <SelectInput className={cn(CARD_INPUT, 'cursor-pointer')} value={p.category} onChange={(e) => updatePossible(p.key, 'category', e.target.value)}>
                            {COMFY_MODEL_FOLDERS.map((f) => <option key={f} value={f}>{LOADER_CAT_LABELS[f] ?? f}</option>)}
                          </SelectInput>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div><label className={CARD_LABEL}>Download URL <InfoTooltip text="Where to download this model" /></label><input className={CARD_INPUT} value={p.provenance.download_url} onChange={(e) => updatePossibleProvenance(p.key, 'download_url', e.target.value)} placeholder="https://huggingface.co/..." /></div>
                          <div><label className={CARD_LABEL}>Size (bytes) <InfoTooltip text="File size in bytes" /></label><input type="number" className={CARD_INPUT} value={p.provenance.size_bytes} onChange={(e) => updatePossibleProvenance(p.key, 'size_bytes', e.target.value)} placeholder="e.g. 7105348616" /></div>
                          <div><label className={CARD_LABEL}>License ID <InfoTooltip text="License governing use of this model" /></label><input className={CARD_INPUT} value={p.provenance.license_id} onChange={(e) => updatePossibleProvenance(p.key, 'license_id', e.target.value)} placeholder="e.g. Apache 2.0" /></div>
                          <div><label className={CARD_LABEL}>License URL <InfoTooltip text="Link to the license text" /></label><input className={CARD_INPUT} value={p.provenance.license_url} onChange={(e) => updatePossibleProvenance(p.key, 'license_url', e.target.value)} placeholder="https://..." /></div>
                          <div><label className={CARD_LABEL}>Attribution <InfoTooltip text="Credit the creator or source of this model" /></label><input className={CARD_INPUT} value={p.provenance.attribution_name} onChange={(e) => updatePossibleProvenance(p.key, 'attribution_name', e.target.value)} placeholder="Creator or organization" /></div>
                          <div><label className={CARD_LABEL}>Attribution URL <InfoTooltip text="Link to the creator's page or original source" /></label><input className={CARD_INPUT} value={p.provenance.attribution_url} onChange={(e) => updatePossibleProvenance(p.key, 'attribution_url', e.target.value)} placeholder="https://..." /></div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Unseen loaders + any models added for each */}
            {unseenLoaders.map((ul) => {
              const addedForLoader = possibleModels.filter((p) => p.forLoaderNodeId === ul.nodeId);
              return (
                <React.Fragment key={ul.nodeId}>
                  <div className="border border-[#FDE68A] bg-[#FFFBEB] rounded-[8px] p-5">
                    <div className="flex items-start gap-3">
                      <div className="shrink-0">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#D97706" strokeWidth="1.5" strokeLinejoin="round" />
                          <path d="M12 9v4" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" />
                          <circle cx="12" cy="17" r="0.75" fill="#D97706" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-[12px] text-[#939393] mb-0.5">Missing filename</p>
                        <p className="text-[15px] font-semibold text-black">{ul.nodeTitle}</p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          {ul.loads.length > 0 ? (
                            ul.loads.map((cat) => (
                              <button
                                key={cat}
                                onClick={() => addManualModel(cat, ul.nodeId)}
                                className="border border-[#E9E9E9] bg-white rounded-[8px] px-3 py-1.5 text-[13px] text-black hover:border-[#B0B0B0] transition-colors"
                              >
                                + Add {LOADER_CAT_LABELS[cat] ?? cat} Model
                              </button>
                            ))
                          ) : (
                            <button
                              onClick={() => addManualModel('checkpoints', ul.nodeId)}
                              className="border border-[#E9E9E9] bg-white rounded-[8px] px-3 py-1.5 text-[13px] text-black hover:border-[#B0B0B0] transition-colors"
                            >
                              + Add Model
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {addedForLoader.map((p) => (
                    <div
                      key={p.key}
                      className={cn('border rounded-[8px] p-5 transition-colors', p.selected ? 'border-black' : 'border-[#E9E9E9]')}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={p.selected}
                          onChange={(e) => updatePossible(p.key, 'selected', e.target.checked)}
                          className="mt-1 shrink-0 w-4 h-4 accent-black cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          {!p.selected && (
                            <p
                              className="text-[15px] font-semibold text-black cursor-pointer transition-colors hover:text-[#939393]"
                              onClick={() => updatePossible(p.key, 'selected', !p.selected)}
                            >
                              {p.fileName || 'New model'}
                            </p>
                          )}
                          {p.selected && (
                            <div className="space-y-4">
                              <div>
                                <label className={CARD_LABEL}><span>File name<span className="text-red-500 ml-px">*</span></span> <InfoTooltip text="The model filename as referenced in the workflow graph" /></label>
                                <input className={CARD_INPUT} value={p.fileName} onChange={(e) => updatePossible(p.key, 'fileName', e.target.value)} placeholder="filename.safetensors" />
                              </div>
                              <div>
                                <label className={CARD_LABEL}><span>Category<span className="text-red-500 ml-px">*</span></span> <InfoTooltip text="The ComfyUI subfolder where this model is stored" /></label>
                                <SelectInput className={cn(CARD_INPUT, 'cursor-pointer')} value={p.category} onChange={(e) => updatePossible(p.key, 'category', e.target.value)}>
                                  {COMFY_MODEL_FOLDERS.map((f) => <option key={f} value={f}>{LOADER_CAT_LABELS[f] ?? f}</option>)}
                                </SelectInput>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div><label className={CARD_LABEL}>Download URL <InfoTooltip text="Where to download this model" /></label><input className={CARD_INPUT} value={p.provenance.download_url} onChange={(e) => updatePossibleProvenance(p.key, 'download_url', e.target.value)} placeholder="https://huggingface.co/..." /></div>
                                <div><label className={CARD_LABEL}>Size (bytes) <InfoTooltip text="File size in bytes" /></label><input type="number" className={CARD_INPUT} value={p.provenance.size_bytes} onChange={(e) => updatePossibleProvenance(p.key, 'size_bytes', e.target.value)} placeholder="e.g. 7105348616" /></div>
                                <div><label className={CARD_LABEL}>License ID <InfoTooltip text="License governing use of this model" /></label><input className={CARD_INPUT} value={p.provenance.license_id} onChange={(e) => updatePossibleProvenance(p.key, 'license_id', e.target.value)} placeholder="e.g. Apache 2.0" /></div>
                                <div><label className={CARD_LABEL}>License URL <InfoTooltip text="Link to the license text" /></label><input className={CARD_INPUT} value={p.provenance.license_url} onChange={(e) => updatePossibleProvenance(p.key, 'license_url', e.target.value)} placeholder="https://..." /></div>
                                <div><label className={CARD_LABEL}>Attribution <InfoTooltip text="Credit the creator or source of this model" /></label><input className={CARD_INPUT} value={p.provenance.attribution_name} onChange={(e) => updatePossibleProvenance(p.key, 'attribution_name', e.target.value)} placeholder="Creator or organization" /></div>
                                <div><label className={CARD_LABEL}>Attribution URL <InfoTooltip text="Link to the creator's page or original source" /></label><input className={CARD_INPUT} value={p.provenance.attribution_url} onChange={(e) => updatePossibleProvenance(p.key, 'attribution_url', e.target.value)} placeholder="https://..." /></div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </React.Fragment>
              );
            })}

            {/* Scan-detected + ungrouped models */}
            {possibleModels.filter((p) => !p.forLoaderNodeId && p.nodeId !== null).map((p) => (
              <div
                key={p.key}
                className={cn('border rounded-[8px] p-5 transition-colors', p.selected ? 'border-black' : 'border-[#E9E9E9]')}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={p.selected}
                    onChange={(e) => updatePossible(p.key, 'selected', e.target.checked)}
                    className="mt-1 shrink-0 w-4 h-4 accent-black cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    {!p.selected ? (
                      <div
                        className="group cursor-pointer"
                        onClick={() => updatePossible(p.key, 'selected', !p.selected)}
                      >
                        <p className="text-[15px] font-semibold text-black transition-colors group-hover:text-[#939393]">{p.nodeTitle || p.fileName}</p>
                        <p className="text-[12px] text-[#939393] font-mono mt-0.5 transition-colors group-hover:text-[#B0B0B0]">{p.fileName}</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div
                          className="group cursor-pointer"
                          onClick={() => updatePossible(p.key, 'selected', !p.selected)}
                        >
                          <p className="text-[15px] font-semibold text-black transition-colors group-hover:text-[#939393]">{p.nodeTitle || p.fileName}</p>
                          <p className="text-[12px] text-[#939393] font-mono mt-0.5 transition-colors group-hover:text-[#B0B0B0]">{p.fileName}</p>
                        </div>
                        <div>
                          <label className={CARD_LABEL}><span>Category<span className="text-red-500 ml-px">*</span></span> <InfoTooltip text="The ComfyUI subfolder where this model is stored" /></label>
                          <SelectInput className={cn(CARD_INPUT, 'cursor-pointer')} value={p.category} onChange={(e) => updatePossible(p.key, 'category', e.target.value)}>
                            {COMFY_MODEL_FOLDERS.map((f) => <option key={f} value={f}>{LOADER_CAT_LABELS[f] ?? f}</option>)}
                          </SelectInput>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div><label className={CARD_LABEL}>Download URL <InfoTooltip text="Where to download this model" /></label><input className={CARD_INPUT} value={p.provenance.download_url} onChange={(e) => updatePossibleProvenance(p.key, 'download_url', e.target.value)} placeholder="https://huggingface.co/..." /></div>
                          <div><label className={CARD_LABEL}>Size (bytes) <InfoTooltip text="File size in bytes" /></label><input type="number" className={CARD_INPUT} value={p.provenance.size_bytes} onChange={(e) => updatePossibleProvenance(p.key, 'size_bytes', e.target.value)} placeholder="e.g. 7105348616" /></div>
                          <div><label className={CARD_LABEL}>License ID <InfoTooltip text="License governing use of this model" /></label><input className={CARD_INPUT} value={p.provenance.license_id} onChange={(e) => updatePossibleProvenance(p.key, 'license_id', e.target.value)} placeholder="e.g. Apache 2.0" /></div>
                          <div><label className={CARD_LABEL}>License URL <InfoTooltip text="Link to the license text" /></label><input className={CARD_INPUT} value={p.provenance.license_url} onChange={(e) => updatePossibleProvenance(p.key, 'license_url', e.target.value)} placeholder="https://..." /></div>
                          <div><label className={CARD_LABEL}>Attribution <InfoTooltip text="Credit the creator or source of this model" /></label><input className={CARD_INPUT} value={p.provenance.attribution_name} onChange={(e) => updatePossibleProvenance(p.key, 'attribution_name', e.target.value)} placeholder="Creator or organization" /></div>
                          <div><label className={CARD_LABEL}>Attribution URL <InfoTooltip text="Link to the creator's page or original source" /></label><input className={CARD_INPUT} value={p.provenance.attribution_url} onChange={(e) => updatePossibleProvenance(p.key, 'attribution_url', e.target.value)} placeholder="https://..." /></div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {unseenLoaders.length === 0 && possibleModels.length === 0 && (
              <div>
                <p className="text-[13px] text-[#939393]">No models found in this workflow.</p>
                <button
                  onClick={() => addManualModel('checkpoints', null)}
                  className="mt-3 border border-[#E9E9E9] bg-white rounded-[8px] px-3 py-1.5 text-[13px] text-black hover:border-[#B0B0B0] transition-colors"
                >
                  + Add Model
                </button>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── Step 4: Variables ──────────────────────────────────────────── */}
      {step === 'variables' && (
        <div>
          <div className="space-y-4">
            {validationErrors.length > 0 && (
              <UploadAlert kind="error" title="Fix before continuing" message={validationErrors.join(' ')} />
            )}

            {/* Variable cards */}
            {variables.map((v, idx) => (
              <div key={v.nodeId} className="border border-[#E9E9E9] rounded-[8px] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <code className="font-mono text-[13px] font-medium text-black">{v.token || '(needs a name)'}</code>
                  <span className="border border-[#E9E9E9] rounded-[6px] px-2 py-0.5 text-[12px] text-[#939393] capitalize bg-white">{v.type}</span>
                </div>

                <div className="mb-4">
                  <label className={CARD_LABEL}><span>Variable name<span className="text-red-500 ml-px">*</span></span> <InfoTooltip text="Human-readable label shown when running this workflow" /></label>
                  <input className={CARD_INPUT} value={v.name} onChange={(e) => updateVar(idx, 'name', e.target.value)} placeholder="e.g. Adherence" />
                </div>

                {(v.type === 'int' || v.type === 'float') && (
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div><label className={CARD_LABEL}><span>Default<span className="text-red-500 ml-px">*</span></span> <InfoTooltip text="Starting value when the workflow is loaded" /></label><input className={CARD_INPUT} value={v.default} onChange={(e) => updateVar(idx, 'default', e.target.value)} /></div>
                    <div className="flex items-end gap-2">
                      <div className="flex-1 min-w-0"><label className={CARD_LABEL}><span>Min<span className="text-red-500 ml-px">*</span></span> <InfoTooltip text="Minimum allowed value" /></label><input className={CARD_INPUT} value={v.min} onChange={(e) => updateVar(idx, 'min', e.target.value)} /></div>
                      <span className="text-[#939393] text-[13px] pb-2.5">–</span>
                      <div className="flex-1 min-w-0"><label className={CARD_LABEL}><span>Max<span className="text-red-500 ml-px">*</span></span> <InfoTooltip text="Maximum allowed value" /></label><input className={CARD_INPUT} value={v.max} onChange={(e) => updateVar(idx, 'max', e.target.value)} /></div>
                    </div>
                    <div><label className={CARD_LABEL}><span>Step<span className="text-red-500 ml-px">*</span></span> <InfoTooltip text="Increment between selectable values" /></label><input className={CARD_INPUT} value={v.step} onChange={(e) => updateVar(idx, 'step', e.target.value)} /></div>
                  </div>
                )}

                <div>
                  <label className={CARD_LABEL}>Description <InfoTooltip text="Explanation of what this variable controls, shown in the Rhino Plugin" /></label>
                  <input className={CARD_INPUT} value={v.description} onChange={(e) => updateVar(idx, 'description', e.target.value)} placeholder="e.g. For adjusting the softness of the output" />
                </div>
              </div>
            ))}

            {variables.length === 0 && (
              <UploadAlert kind="warning" title="No variables found" message="No variable nodes were detected in this workflow." />
            )}

            {/* Seed card */}
            <div className="border border-[#E9E9E9] rounded-[8px] p-5">
              <div className="flex items-center gap-3">
                <code className="font-mono text-[13px] font-medium text-black">{SEED_TOKEN}</code>
                <span className="border border-[#E9E9E9] rounded-[6px] px-2 py-0.5 text-[12px] text-[#939393] bg-white">Seed</span>
              </div>
              {seedNodeIds.length === 0 && (
                <div className="mt-4">
                  <UploadAlert kind="warning" title="Missing Node" message={`No ${PSEUDO_SEED_NODE} node found.`} />
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ── Step 5: Metadata ───────────────────────────────────────────── */}
      {step === 'metadata' && (
        <div>
          <div className="space-y-4">
            {/* Workflow Details */}
            <div className="border border-[#E9E9E9] rounded-[8px] p-5">
              <p className="text-[13px] font-semibold text-black mb-4">Workflow Details</p>
              <div className="space-y-4">
                <div>
                  <label className={CARD_LABEL}><span>Workflow name<span className="text-red-500 ml-px">*</span></span> <InfoTooltip text="Name shown in the Rhino Plugin workflow browser" /></label>
                  <input className={CARD_INPUT} value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} placeholder="e.g. Juggernaut" />
                </div>
                <div>
                  <label className={CARD_LABEL}>Description <InfoTooltip text="Explanation of what this variable controls, shown in the Rhino Plugin" /></label>
                  <input className={CARD_INPUT} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Generates product photography with soft studio lighting" />
                </div>
                <div>
                  <label className={CARD_LABEL}>Thumbnail <InfoTooltip text="Preview image shown in the workflow gallery" /></label>
                  <input ref={thumbInputRef} type="file" accept="image/*" className="hidden" onChange={handleThumbChange} />
                  <div className="flex items-center gap-3">
                    {thumbnailDataUri && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbnailDataUri} alt="Thumbnail" className="w-16 h-16 object-cover rounded-[8px] border border-[#E9E9E9]" />
                    )}
                    <button type="button" onClick={() => thumbInputRef.current?.click()} className="border border-[#E9E9E9] rounded-[8px] px-3 py-1.5 text-[13px] text-black hover:border-[#B0B0B0] transition-colors">
                      {thumbnailDataUri ? 'Replace image' : 'Upload image'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Attribution Details */}
            <div className="border border-[#E9E9E9] rounded-[8px] p-5">
              <p className="text-[13px] font-semibold text-black mb-4">Attribution Details</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={CARD_LABEL}>Author <InfoTooltip text="Creator of this workflow" /></label>
                  <input className={CARD_INPUT} value={attribution.author} onChange={(e) => setAttribution((a) => ({ ...a, author: e.target.value }))} placeholder="e.g John Doe" />
                </div>
                <div>
                  <label className={CARD_LABEL}>Author URL <InfoTooltip text="Link to the author's profile or website" /></label>
                  <input className={CARD_INPUT} type="url" value={attribution.author_url} onChange={(e) => setAttribution((a) => ({ ...a, author_url: e.target.value }))} placeholder="https://..." />
                </div>
                <div className="col-span-2">
                  <label className={CARD_LABEL}>License <InfoTooltip text="License governing use of this model" /></label>
                  <input className={CARD_INPUT} value={attribution.license} onChange={(e) => setAttribution((a) => ({ ...a, license: e.target.value }))} placeholder="e.g Apache 2.0" />
                </div>
              </div>
            </div>

            {/* Capability Flags */}
            <div className="border border-[#E9E9E9] rounded-[8px] p-5">
              <p className="text-[13px] font-semibold text-black mb-4">Capability Flags</p>
              <div className="space-y-4">
                {([
                  { key: 'global_guidance_capabilities' as const, label: 'Global Guidance' },
                  { key: 'regional_guidance_capabilities' as const, label: 'Regional Guidance' },
                  { key: 'spatial_guidance_capabilities' as const, label: 'Spatial Guidance' },
                ] as const).map(({ key, label }) => (
                  <div key={key}>
                    <p className="text-[12px] text-[#939393] mb-2">{label}</p>
                    <div className="flex flex-wrap gap-4">
                      {Object.keys(caps[key]).map((flagKey) => (
                        <label key={flagKey} className="flex items-center gap-2 text-[13px] text-black cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(caps[key] as Record<string, boolean>)[flagKey]}
                            onChange={() => toggleCap(key, flagKey)}
                            className="w-4 h-4 accent-black"
                          />
                          <span>{CAP_LABELS[flagKey]?.name ?? flagKey}</span>
                          {CAP_LABELS[flagKey]?.type && (
                            <span className="text-[12px] text-[#939393]">({CAP_LABELS[flagKey]?.type})</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ── Step 6: Preview & Download ─────────────────────────────────── */}
      {step === 'preview' && (
        <div className="flex-1 flex flex-col min-h-0">
          <JsonTree
            data={buildOutput()}
            bare
            fill
            contentBorder
            actions={
              <button
                onClick={downloadOutput}
                className="flex items-center gap-1.5 border border-[#E9E9E9] rounded-[8px] px-3 py-1.5 text-[13px] text-black hover:border-[#B0B0B0] transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download .pseudorandom.json
              </button>
            }
          />

        </div>
      )}

          </div>{/* end content */}
        </div>{/* end overflow-y-auto */}

        {/* Fade gradient above fixed nav */}
        {step !== 'preview' && <div className="pointer-events-none absolute left-0 right-0 bottom-[78px] h-14 bg-gradient-to-t from-white to-transparent z-10" />}

        {/* Fixed nav button bar */}
        <div className="shrink-0 relative z-20 px-10 pt-4 pb-9 flex justify-between max-w-[800px]">
          {step === 'upload' ? (
            <button disabled className="flex items-center justify-center px-5 py-[6px] gap-[10px] rounded-[8px] bg-white border border-[#D4D4D4] text-[13px] text-[#B0B0B0] cursor-not-allowed">Back</button>
          ) : step === 'requirements' ? (
            <button onClick={() => setStep('upload')} className="flex items-center justify-center px-5 py-[6px] gap-[10px] rounded-[8px] bg-white border border-black text-[13px] text-black hover:bg-zinc-50 cursor-pointer transition-colors">Back</button>
          ) : step === 'possible-models' ? (
            <button onClick={() => setStep('requirements')} className="flex items-center justify-center px-5 py-[6px] gap-[10px] rounded-[8px] bg-white border border-black text-[13px] text-black hover:bg-zinc-50 cursor-pointer transition-colors">Back</button>
          ) : step === 'variables' ? (
            <button onClick={() => setStep('possible-models')} className="flex items-center justify-center px-5 py-[6px] gap-[10px] rounded-[8px] bg-white border border-black text-[13px] text-black hover:bg-zinc-50 cursor-pointer transition-colors">Back</button>
          ) : step === 'metadata' ? (
            <button onClick={() => setStep('variables')} className="flex items-center justify-center px-5 py-[6px] gap-[10px] rounded-[8px] bg-white border border-black text-[13px] text-black hover:bg-zinc-50 cursor-pointer transition-colors">Back</button>
          ) : (
            <button onClick={() => setStep('metadata')} className="flex items-center justify-center px-5 py-[6px] gap-[10px] rounded-[8px] bg-white border border-black text-[13px] text-black hover:bg-zinc-50 cursor-pointer transition-colors">Back</button>
          )}
          {step === 'upload' ? (
            <button
              disabled={rawGraph === null || !!blockingError || matchLoading}
              onClick={handleContinueFromUpload}
              className="flex items-center justify-center px-5 py-[6px] gap-[10px] rounded-[8px] bg-black text-[13px] text-white hover:opacity-60 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {matchLoading ? 'Looking up models…' : 'Next'}
            </button>
          ) : step === 'requirements' ? (
            <button onClick={() => setStep('possible-models')} className="flex items-center justify-center px-5 py-[6px] gap-[10px] rounded-[8px] bg-black text-[13px] text-white hover:opacity-60 cursor-pointer transition-opacity">Next</button>
          ) : step === 'possible-models' ? (
            <button onClick={() => setStep('variables')} className="flex items-center justify-center px-5 py-[6px] gap-[10px] rounded-[8px] bg-black text-[13px] text-white hover:opacity-60 cursor-pointer transition-opacity">Next</button>
          ) : step === 'variables' ? (
            <button onClick={handleContinueFromVariables} className="flex items-center justify-center px-5 py-[6px] gap-[10px] rounded-[8px] bg-black text-[13px] text-white hover:opacity-60 cursor-pointer transition-opacity">Next</button>
          ) : step === 'metadata' ? (
            <button disabled={!workflowName} onClick={() => setStep('preview')} className="flex items-center justify-center px-5 py-[6px] gap-[10px] rounded-[8px] bg-black text-[13px] text-white hover:opacity-60 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">Next</button>
          ) : (
            <button onClick={() => router.push('/')} className="flex items-center justify-center px-5 py-[6px] gap-[10px] rounded-[8px] bg-black text-[13px] text-white hover:opacity-60 cursor-pointer transition-opacity">Done</button>
          )}
        </div>
        </div>{/* end main content column */}

        {/* Right code preview panel — hidden on preview step, draggable width */}
        {rawGraph !== null && step !== 'preview' && (
          panelMinimized ? (
            <div
              className="shrink-0 ml-auto border-l border-t border-b border-[#E9E9E9] rounded-l-[8px] flex items-center justify-center cursor-pointer hover:bg-zinc-50 transition-colors mb-6"
              style={{ width: 32 }}
              onClick={() => setPanelMinimized(false)}
            >
              <span
                className="text-[11px] text-[#939393] font-medium whitespace-nowrap select-none"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                {outputFileName}
              </span>
            </div>
          ) : (
            <div
              ref={rightPanelRef}
              className={cn(
                'min-w-[280px] border border-[#E9E9E9] rounded-[8px] flex flex-col overflow-hidden relative mr-6 mb-6',
                // Once given a fixed width it stops growing, so without ml-auto
                // the flex row packs it left (flex-start) instead of leaving
                // any slack space on the right — it'd drift away from the
                // right edge as soon as it's narrower than the leftover space.
                rightPanelWidth == null ? 'flex-1' : 'shrink-0 ml-auto'
              )}
              style={rightPanelWidth != null ? { width: rightPanelWidth } : undefined}
            >
              {/* Drag handle on the left edge */}
              <div
                onMouseDown={handlePanelDragStart}
                className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#D4D4D4] transition-colors z-10"
              />
              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E9E9E9] shrink-0">
                <button
                  onClick={() => setPanelMinimized(true)}
                  className="text-[#939393] hover:text-black transition-colors shrink-0"
                >
                  <HamburgerIcon />
                </button>
                <span className="text-[13px] font-medium text-black truncate flex-1">{outputFileName}</span>
                {(diffAdded > 0 || diffRemoved > 0) && (
                  <div className="flex items-center gap-2 shrink-0 font-mono text-[12px] font-semibold">
                    {diffAdded > 0 && <span className="text-[#3fb950]">+{diffAdded}</span>}
                    {diffRemoved > 0 && <span className="text-[#f85149]">-{diffRemoved}</span>}
                  </div>
                )}
              </div>
              {/* Diff content */}
              <div ref={codeScrollRef} className="flex-1 overflow-auto font-mono text-[11px] leading-[1.6]">
                {diffResult ? diffResult.map((line, idx) => (
                  <div
                    key={idx}
                    ref={(el) => { codeLineRefs.current[idx] = el; }}
                    className={
                      line.type === 'add' ? 'bg-[#eaffee] px-4' :
                      line.type === 'remove' ? 'bg-[#fff0f0] px-4' :
                      'text-[#57606a] px-4'
                    }
                  >
                    <span className={cn(
                      'select-none mr-2',
                      line.type === 'add' ? 'text-[#1a7f37]' :
                      line.type === 'remove' ? 'text-[#cf222e]' :
                      'opacity-0'
                    )}>
                      {line.type === 'add' ? '+' : '-'}
                    </span>
                    <span className={line.type === 'same' ? '' : 'text-[#24292f]'}>{line.text}</span>
                  </div>
                )) : (
                  <pre className="px-4 py-4 text-[#57606a] whitespace-pre">{currentOutputStr}</pre>
                )}
              </div>
            </div>
          )
        )}
      </div>{/* end content area */}

      </div>{/* end three-column row */}
    </div>
  );
}
