'use client';

import {
  GENERIC_LOADER_CLASS_TYPES,
  LOADER_FILENAME_INPUT,
  VETTED_NODE_CLASS_TYPES,
} from '@/config/vettedNodeTypes';
import { Model, VettingStatus } from '@/types/database';
import { cn } from '@/utils/cn';
import { useCallback, useRef, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

type ComfyNode = {
  inputs: Record<string, unknown>;
  class_type: string;
  _meta?: { title?: string };
};

type ComfyGraph = Record<string, ComfyNode>;

type DetectedRequirement = {
  nodeId: string;
  nodeTitle: string;
  class_type: string;
  category: string;
  fileName: string;
  dbMatch: Model | null;
  provenance_id: string | null;
  vetting_status: VettingStatus;
};

type DetectedVariable = {
  nodeId: string;
  token: string;
  name: string;
  description: string;
  type: string;
  default: string;
  min: string;
  max: string;
  step: string;
};

type WorkflowAttribution = {
  author: string;
  author_url: string;
  license: string;
};

type CapabilityFlags = {
  global_guidance_capabilities: {
    txt_scene: boolean;
    txt_style: boolean;
    txt_negative: boolean;
    img_style: boolean;
  };
  regional_guidance_capabilities: {
    text: boolean;
    image: boolean;
  };
  spatial_guidance_capabilities: {
    depth: boolean;
    edge: boolean;
  };
};

type WizardStep = 'upload' | 'requirements' | 'variables' | 'metadata' | 'preview';

// ── Helpers ─────────────────────────────────────────────────────────────────

const PLACEHOLDER_TOKEN_RE = /__[A-Z_]+__/g;

function extractRequirements(graph: ComfyGraph): DetectedRequirement[] {
  const results: DetectedRequirement[] = [];

  for (const [nodeId, node] of Object.entries(graph)) {
    const { class_type, inputs, _meta } = node;
    const nodeTitle = _meta?.title ?? class_type;

    // Check Kyle's vetted node types first (authoritative; no filename matching needed)
    if (VETTED_NODE_CLASS_TYPES.includes(class_type)) {
      const modelId = inputs['model_id'] as string | undefined;
      results.push({
        nodeId,
        nodeTitle,
        class_type,
        category: 'checkpoints',
        fileName: String(inputs['model_name'] ?? ''),
        dbMatch: null,
        provenance_id: modelId ?? null,
        vetting_status: 'vetted',
      });
      continue;
    }

    // Generic loader fallback — filename-based matching
    const category = GENERIC_LOADER_CLASS_TYPES[class_type];
    if (!category) continue;

    const fileNameKey = LOADER_FILENAME_INPUT[class_type] ?? 'model_name';
    const fileName = inputs[fileNameKey];
    if (typeof fileName !== 'string' || !fileName) continue;

    results.push({
      nodeId,
      nodeTitle,
      class_type,
      category,
      fileName,
      dbMatch: null,
      provenance_id: null,
      vetting_status: 'unknown',
    });
  }

  return results;
}

function extractVariables(graph: ComfyGraph): DetectedVariable[] {
  const found: DetectedVariable[] = [];
  const seen = new Set<string>();

  for (const [nodeId, node] of Object.entries(graph)) {
    for (const value of Object.values(node.inputs)) {
      if (typeof value !== 'string') continue;
      const tokens = value.match(PLACEHOLDER_TOKEN_RE);
      if (!tokens) continue;
      for (const token of tokens) {
        if (seen.has(token)) continue;
        seen.add(token);
        const readableName = token
          .replace(/^__|__$/g, '')
          .toLowerCase()
          .replace(/_/g, ' ');
        found.push({
          nodeId,
          token,
          name: readableName,
          description: '',
          type: 'float',
          default: '0',
          min: '0',
          max: '1',
          step: '0.01',
        });
      }
    }
  }

  return found;
}

// ── Shared input styles ──────────────────────────────────────────────────────

const inputClass =
  'block w-full border border-zinc-300 rounded-sm px-3 py-2 text-sm text-zinc-900 bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400';
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-1';

// ── Step progress indicator ──────────────────────────────────────────────────

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'requirements', label: 'Requirements' },
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
            {i < currentIdx ? '✓' : i + 1}
          </div>
          <span
            className={cn(
              'ml-1.5 text-xs hidden sm:inline',
              i <= currentIdx ? 'text-zinc-700' : 'text-zinc-300'
            )}
          >
            {step.label}
          </span>
          {i < STEPS.length - 1 && (
            <div
              className={cn(
                'mx-2 h-px w-8',
                i < currentIdx ? 'bg-zinc-900' : 'bg-zinc-200'
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main Wizard ──────────────────────────────────────────────────────────────

export default function WorkflowWizard() {
  const [step, setStep] = useState<WizardStep>('upload');
  const [graph, setGraph] = useState<ComfyGraph | null>(null);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<DetectedRequirement[]>([]);
  const [variables, setVariables] = useState<DetectedVariable[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);

  // Top-level metadata
  const [workflowName, setWorkflowName] = useState('');
  const [description, setDescription] = useState('');
  const [thumbnailDataUri, setThumbnailDataUri] = useState('');
  const [attribution, setAttribution] = useState<WorkflowAttribution>({
    author: '',
    author_url: '',
    license: '',
  });
  const [caps, setCaps] = useState<CapabilityFlags>({
    global_guidance_capabilities: {
      txt_scene: false,
      txt_style: false,
      txt_negative: false,
      img_style: false,
    },
    regional_guidance_capabilities: { text: false, image: false },
    spatial_guidance_capabilities: { depth: false, edge: false },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // ── Step 1: Upload ───────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    setParseError(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      // ComfyUI exports are a flat map of nodeId → node object
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected a ComfyUI workflow export (a JSON object of nodes).');
      }

      setGraph(parsed as ComfyGraph);
      const detected = extractRequirements(parsed as ComfyGraph);
      const vars = extractVariables(parsed as ComfyGraph);
      setRequirements(detected);
      setVariables(vars);
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
    if (!graph) return;
    // Match requirements against DB
    setMatchLoading(true);
    try {
      const res = await fetch('/api/models');
      const allModels: Model[] = res.ok ? await res.json() : [];

      setRequirements((prev) =>
        prev.map((req) => {
          // Vetted node types already have provenance_id from the node itself
          if (VETTED_NODE_CLASS_TYPES.includes(req.class_type)) {
            const dbMatch = allModels.find((m) => m.id === req.provenance_id) ?? null;
            return {
              ...req,
              dbMatch,
              vetting_status: (dbMatch?.vetting_status_id ?? 'vetted') as VettingStatus,
            };
          }

          // Generic loader — match by file_name
          const dbMatch =
            allModels.find(
              (m) => m.file_name.toLowerCase() === req.fileName.toLowerCase()
            ) ?? null;
          return {
            ...req,
            dbMatch,
            provenance_id: dbMatch?.id ?? null,
            vetting_status: (dbMatch?.vetting_status_id ?? 'unknown') as VettingStatus,
          };
        })
      );
    } finally {
      setMatchLoading(false);
    }
    setStep('requirements');
  };

  // ── Step 3: Variables ────────────────────────────────────────────────────

  const updateVar = (idx: number, field: keyof DetectedVariable, value: string) => {
    setVariables((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  // ── Step 4: Metadata — thumbnail ────────────────────────────────────────

  const handleThumbChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setThumbnailDataUri(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const toggleCap = (
    group: keyof CapabilityFlags,
    key: string
  ) => {
    setCaps((prev) => ({
      ...prev,
      [group]: {
        ...(prev[group] as Record<string, boolean>),
        [key]: !(prev[group] as Record<string, boolean>)[key],
      },
    }));
  };

  // ── Step 5: Assemble output ──────────────────────────────────────────────

  const buildOutput = () => {
    const endpointRequirements = requirements.map((req) => {
      const entry: Record<string, unknown> = {
        category: req.category,
        requirement: req.fileName,
        vetting_status: req.vetting_status,
      };
      if (req.provenance_id) entry.provenance_id = req.provenance_id;
      return entry;
    });

    const variablesDef = variables.map((v) => ({
      name: v.name,
      type: v.type,
      description: v.description,
      default: isNaN(Number(v.default)) ? v.default : Number(v.default),
      binds_to: v.token,
      min: isNaN(Number(v.min)) ? v.min : Number(v.min),
      max: isNaN(Number(v.max)) ? v.max : Number(v.max),
      step: isNaN(Number(v.step)) ? v.step : Number(v.step),
    }));

    return {
      pseudorandom_workflow_schema_version: '0.3',
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
      endpoint_requirements: endpointRequirements,
      workflow: graph,
    };
  };

  const downloadOutput = () => {
    const output = buildOutput();
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(workflowName || 'workflow').replace(/\s+/g, '_').toLowerCase()}.pseudorandom.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      <StepIndicator current={step} />

      {/* ── Step 1: Upload ─────────────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="space-y-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
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
            {fileName ? (
              <div>
                <p className="font-medium text-zinc-900">{fileName}</p>
                <p className="text-xs text-zinc-400 mt-1">Click to replace</p>
              </div>
            ) : (
              <div>
                <p className="text-zinc-500 mb-1">Drag and drop a ComfyUI workflow JSON file</p>
                <p className="text-xs text-zinc-400">or click to browse</p>
              </div>
            )}
          </div>

          {parseError && (
            <div className="border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-sm">
              {parseError}
            </div>
          )}

          {graph && (
            <div className="border border-zinc-200 rounded-sm px-4 py-3 text-sm text-zinc-600">
              Parsed <strong>{Object.keys(graph).length}</strong> nodes.{' '}
              Found <strong>{requirements.length}</strong> model requirement(s) and{' '}
              <strong>{variables.length}</strong> placeholder variable(s).
            </div>
          )}

          <div className="flex justify-end">
            <button
              disabled={!graph || matchLoading}
              onClick={handleContinueFromUpload}
              className="border border-zinc-300 rounded-sm px-6 py-2 text-sm font-medium text-zinc-900 bg-white hover:bg-zinc-50 disabled:opacity-40 transition-colors"
            >
              {matchLoading ? 'Matching against database...' : 'Continue →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Requirements ──────────────────────────────────────── */}
      {step === 'requirements' && (
        <div className="space-y-6">
          <div className="border border-zinc-200 rounded-sm p-5">
            <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500 mb-4">
              Detected Model Requirements
            </div>

            {requirements.length === 0 ? (
              <p className="text-sm text-zinc-400">
                No model-loading nodes detected. Click Continue to proceed.
              </p>
            ) : (
              <div className="space-y-6">
                {requirements.map((req, idx) => (
                  <div key={req.nodeId} className="border border-zinc-100 rounded-sm p-4">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <p className="font-medium text-sm text-zinc-900">{req.fileName}</p>
                        <p className="text-xs text-zinc-400">
                          {req.nodeTitle} · {req.category}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'text-xs px-2 py-0.5 border rounded-sm shrink-0',
                          req.dbMatch
                            ? 'border-green-200 bg-green-50 text-green-700'
                            : 'border-orange-200 bg-orange-50 text-orange-700'
                        )}
                      >
                        {req.dbMatch ? '✓ Matched in database' : 'Not in database'}
                      </span>
                    </div>

                    {req.dbMatch ? (
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-zinc-500">
                        <span>License: <strong className="text-zinc-700">{req.dbMatch.license ?? '—'}</strong></span>
                        <span>Status: <strong className="text-zinc-700">{req.dbMatch.vetting_status_id}</strong></span>
                        <span className="col-span-2">Attribution: <strong className="text-zinc-700">{req.dbMatch.attribution ?? '—'}</strong></span>
                      </div>
                    ) : (
                      <p className="text-xs text-orange-700">
                        This model isn&apos;t in the database yet. Ask an internal user to add it via{' '}
                        <a href="/models/new" target="_blank" className="underline">Add Model</a>{' '}
                        before publishing this workflow. It will be included with{' '}
                        <code className="font-mono">vetting_status: &quot;unknown&quot;</code> and no provenance_id.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep('upload')} className="border border-zinc-200 rounded-sm px-5 py-2 text-sm text-zinc-500 hover:bg-zinc-50">
              ← Back
            </button>
            <button onClick={() => setStep('variables')} className="border border-zinc-300 rounded-sm px-6 py-2 text-sm font-medium text-zinc-900 bg-white hover:bg-zinc-50 transition-colors">
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Variables ─────────────────────────────────────────── */}
      {step === 'variables' && (
        <div className="space-y-6">
          <div className="border border-zinc-200 rounded-sm p-5">
            <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500 mb-4">
              Detected Placeholder Variables
            </div>

            {variables.length === 0 ? (
              <p className="text-sm text-zinc-400">
                No placeholder tokens (like <code className="font-mono text-xs">__ITERATION__</code>) detected. Click Continue to proceed.
              </p>
            ) : (
              <div className="space-y-6">
                {variables.map((v, idx) => (
                  <div key={v.token} className="border border-zinc-100 rounded-sm p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <code className="font-mono text-xs bg-zinc-100 px-2 py-0.5 rounded">
                        {v.token}
                      </code>
                      <span className="text-xs text-zinc-400">detected in node {v.nodeId}</span>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className={labelClass}>Variable Name</label>
                        <input className={inputClass} value={v.name} onChange={(e) => updateVar(idx, 'name', e.target.value)} placeholder="e.g. iteration count" />
                      </div>
                      <div>
                        <label className={labelClass}>Type</label>
                        <select className={inputClass} value={v.type} onChange={(e) => updateVar(idx, 'type', e.target.value)}>
                          <option value="float">float</option>
                          <option value="int">int</option>
                          <option value="string">string</option>
                          <option value="boolean">boolean</option>
                        </select>
                      </div>
                      <div className="md:col-span-2">
                        <label className={labelClass}>Description</label>
                        <input className={inputClass} value={v.description} onChange={(e) => updateVar(idx, 'description', e.target.value)} placeholder="User-facing description shown in the plugin" />
                      </div>
                      <div>
                        <label className={labelClass}>Default</label>
                        <input className={inputClass} value={v.default} onChange={(e) => updateVar(idx, 'default', e.target.value)} />
                      </div>
                      <div>
                        <label className={labelClass}>Step</label>
                        <input className={inputClass} value={v.step} onChange={(e) => updateVar(idx, 'step', e.target.value)} />
                      </div>
                      <div>
                        <label className={labelClass}>Min</label>
                        <input className={inputClass} value={v.min} onChange={(e) => updateVar(idx, 'min', e.target.value)} />
                      </div>
                      <div>
                        <label className={labelClass}>Max</label>
                        <input className={inputClass} value={v.max} onChange={(e) => updateVar(idx, 'max', e.target.value)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep('requirements')} className="border border-zinc-200 rounded-sm px-5 py-2 text-sm text-zinc-500 hover:bg-zinc-50">
              ← Back
            </button>
            <button onClick={() => setStep('metadata')} className="border border-zinc-300 rounded-sm px-6 py-2 text-sm font-medium text-zinc-900 bg-white hover:bg-zinc-50 transition-colors">
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Metadata ──────────────────────────────────────────── */}
      {step === 'metadata' && (
        <div className="space-y-6">
          {/* Basic info */}
          <div className="border border-zinc-200 rounded-sm p-5 space-y-5">
            <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500">
              Workflow Info
            </div>
            <div>
              <label className={labelClass}>Workflow Name *</label>
              <input className={inputClass} value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} placeholder="e.g. Juggernaut Essential" required />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <textarea className={cn(inputClass, 'min-h-[80px] resize-y')} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this workflow do? What is it good for?" />
            </div>
            <div>
              <label className={labelClass}>Thumbnail</label>
              <input ref={thumbInputRef} type="file" accept="image/*" className="hidden" onChange={handleThumbChange} />
              <div className="flex items-center gap-4">
                {thumbnailDataUri && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbnailDataUri} alt="Thumbnail preview" className="w-20 h-20 object-cover rounded-sm border border-zinc-200" />
                )}
                <button type="button" onClick={() => thumbInputRef.current?.click()} className="text-sm border border-zinc-200 rounded-sm px-3 py-1.5 text-zinc-600 hover:border-zinc-400 transition-colors">
                  {thumbnailDataUri ? 'Replace image' : 'Upload image'}
                </button>
              </div>
              <p className="text-xs text-zinc-400 mt-1">Will be embedded as a base64 data URI in the output file.</p>
            </div>
          </div>

          {/* Attribution */}
          <div className="border border-zinc-200 rounded-sm p-5 space-y-4">
            <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500">
              Workflow Attribution
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Author</label>
                <input className={inputClass} value={attribution.author} onChange={(e) => setAttribution((a) => ({ ...a, author: e.target.value }))} />
              </div>
              <div>
                <label className={labelClass}>Author URL</label>
                <input className={inputClass} type="url" value={attribution.author_url} onChange={(e) => setAttribution((a) => ({ ...a, author_url: e.target.value }))} />
              </div>
              <div>
                <label className={labelClass}>License</label>
                <input className={inputClass} value={attribution.license} onChange={(e) => setAttribution((a) => ({ ...a, license: e.target.value }))} />
              </div>
            </div>
          </div>

          {/* Capability flags */}
          <div className="border border-zinc-200 rounded-sm p-5 space-y-4">
            <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500">
              Capability Flags
            </div>

            <div>
              <p className={labelClass}>Global Guidance</p>
              <div className="flex flex-wrap gap-3">
                {Object.keys(caps.global_guidance_capabilities).map((key) => (
                  <label key={key} className="flex items-center gap-1.5 text-sm text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(caps.global_guidance_capabilities as Record<string, boolean>)[key]}
                      onChange={() => toggleCap('global_guidance_capabilities', key)}
                    />
                    {key}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className={labelClass}>Regional Guidance</p>
              <div className="flex flex-wrap gap-3">
                {Object.keys(caps.regional_guidance_capabilities).map((key) => (
                  <label key={key} className="flex items-center gap-1.5 text-sm text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(caps.regional_guidance_capabilities as Record<string, boolean>)[key]}
                      onChange={() => toggleCap('regional_guidance_capabilities', key)}
                    />
                    {key}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className={labelClass}>Spatial Guidance</p>
              <div className="flex flex-wrap gap-3">
                {Object.keys(caps.spatial_guidance_capabilities).map((key) => (
                  <label key={key} className="flex items-center gap-1.5 text-sm text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(caps.spatial_guidance_capabilities as Record<string, boolean>)[key]}
                      onChange={() => toggleCap('spatial_guidance_capabilities', key)}
                    />
                    {key}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep('variables')} className="border border-zinc-200 rounded-sm px-5 py-2 text-sm text-zinc-500 hover:bg-zinc-50">
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

      {/* ── Step 5: Preview & Download ───────────────────────────────── */}
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
            <pre className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-100 rounded-sm p-4 overflow-auto max-h-[500px] whitespace-pre-wrap break-all">
              {JSON.stringify(
                { ...buildOutput(), workflow: '(workflow graph omitted from preview)' },
                null,
                2
              )}
            </pre>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep('metadata')} className="border border-zinc-200 rounded-sm px-5 py-2 text-sm text-zinc-500 hover:bg-zinc-50">
              ← Back
            </button>
            <button
              onClick={downloadOutput}
              className="border border-zinc-900 bg-zinc-900 text-white rounded-sm px-6 py-2 text-sm font-medium hover:bg-zinc-800 transition-colors"
            >
              Download Workflow
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
