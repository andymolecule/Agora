"use client";

import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json";
import {
  defaultPresetIdForChallengeType,
  OFFICIAL_IMAGES,
  PRESET_REGISTRY,
  validatePresetIntegrity,
  validateScoringContainer,
} from "@hermes/common";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useMemo, useState } from "react";
import { type Abi, parseUnits } from "viem";
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import {
  Wallet, ArrowRight, Coins, AlertCircle, Loader2, CheckCircle,
  FlaskConical, BarChart3, Settings2, ChevronRight, Check,
  Upload, Eye, X, Database, Crosshair,
} from "lucide-react";
import { buildPinSpecMessage, computeSpecHash } from "../../lib/pin-spec-auth";
import { accelerateChallengeIndex } from "../../lib/api";
import { CHAIN_ID, FACTORY_ADDRESS, USDC_ADDRESS } from "../../lib/config";
import { formatUsdc, computeProtocolFee } from "../../lib/format";

const HermesFactoryAbi = HermesFactoryAbiJson as unknown as Abi;

const DISTRIBUTION_TO_ENUM = {
  winner_take_all: 0,
  top_3: 1,
  proportional: 2,
} as const;

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type PostChallengeType = "prediction" | "optimization" | "reproducibility" | "docking" | "custom";

// ─── Icon mapping for presets ───────────────────────
const TYPE_ICONS: Record<PostChallengeType, typeof FlaskConical> = {
  prediction: BarChart3,
  optimization: FlaskConical,
  reproducibility: FlaskConical,
  docking: Crosshair,
  custom: Settings2,
};

const METRIC_OPTIONS = [
  { value: "rmse", label: "RMSE", hint: "Lower is better" },
  { value: "r2", label: "R²", hint: "Higher is better" },
  { value: "mae", label: "MAE", hint: "Lower is better" },
  { value: "pearson", label: "Pearson", hint: "Higher is better" },
  { value: "spearman", label: "Spearman", hint: "Higher is better" },
  { value: "custom", label: "Custom metric", hint: "" },
];

const WINNER_LABELS: Record<string, string> = {
  winner_take_all: "Winner takes entire reward pool",
  top_3: "Reward split among top 3 scorers",
  proportional: "Reward distributed proportionally by score",
};

const REGISTRY_PRESETS = Object.values(PRESET_REGISTRY);
const REPRODUCIBILITY_PRESET_ID =
  defaultPresetIdForChallengeType("reproducibility");
const PREDICTION_PRESET_ID = defaultPresetIdForChallengeType("prediction");
const reproducibilityPreset =
  REPRODUCIBILITY_PRESET_ID &&
  REPRODUCIBILITY_PRESET_ID !== "custom"
    ? PRESET_REGISTRY[REPRODUCIBILITY_PRESET_ID]
    : undefined;
const predictionPreset =
  PREDICTION_PRESET_ID && PREDICTION_PRESET_ID !== "custom"
    ? PRESET_REGISTRY[PREDICTION_PRESET_ID]
    : undefined;

if (!reproducibilityPreset || !predictionPreset) {
  throw new Error(
    "Required presets (reproducibility/prediction) are missing from PRESET_REGISTRY.",
  );
}

const TYPE_CONFIG = {
  prediction: {
    label: "Prediction",
    description: "Solvers predict outcomes on held-out test data (Kaggle-style)",
    defaultDomain: "omics",
    metricHint: "r2",
    container: predictionPreset.container,
    defaultMinimumScore: predictionPreset.defaultMinimumScore,
    presetId: predictionPreset.id,
    scoringTemplate: predictionPreset.scoringDescription,
  },
  optimization: {
    label: "Optimization",
    description: "Solvers submit parameters; your scorer runs the simulation",
    defaultDomain: "drug_discovery",
    metricHint: "custom",
    container: "",
    defaultMinimumScore: 0,
    presetId: "custom",
    scoringTemplate: "",
  },
  reproducibility: {
    label: "Reproducibility",
    description: "Solvers reproduce a known result from a published pipeline",
    defaultDomain: "other",
    metricHint: "custom",
    container: reproducibilityPreset.container,
    defaultMinimumScore: reproducibilityPreset.defaultMinimumScore,
    presetId: reproducibilityPreset.id,
    scoringTemplate: reproducibilityPreset.scoringDescription,
  },
  docking: {
    label: "Docking",
    description: "Solvers dock small molecules against a protein target",
    defaultDomain: "drug_discovery",
    metricHint: "spearman",
    container: OFFICIAL_IMAGES.docking,
    defaultMinimumScore: 0,
    presetId: "custom",
    scoringTemplate: "",
  },
  custom: {
    label: "Custom",
    description: "Bring your own scorer and rules",
    defaultDomain: "other",
    metricHint: "custom",
    container: "",
    defaultMinimumScore: 0,
    presetId: "custom",
    scoringTemplate: "",
  },
} as const;

const TYPE_OPTIONS = Object.keys(TYPE_CONFIG) as PostChallengeType[];

function engineDisplayName(container: string): string {
  const linkedPresets = REGISTRY_PRESETS.filter((preset) => preset.container === container);
  if (linkedPresets.length === 0) {
    return container.length > 40 ? container.slice(0, 40) + "…" : container;
  }
  const names = Array.from(new Set(linkedPresets.map((preset) => preset.label)));
  if (names.length === 1) return `${names[0]} (official)`;
  return `${names[0]} (+${names.length - 1} preset${names.length > 2 ? "s" : ""})`;
}

const SUBMISSION_TYPES = [
  { value: "number", label: "🔢 Number", desc: "Solvers submit a numeric answer.", format: '{"answer": <number>}' },
  { value: "text", label: "📝 Text", desc: "Solvers submit a text response.", format: '{"answer": <string>}' },
  { value: "json", label: "📄 JSON Object", desc: "Solvers submit a structured JSON file.", format: "JSON object (define schema in validation rules)" },
  { value: "csv", label: "📊 CSV", desc: "Solvers submit a CSV file with results.", format: "CSV file" },
  { value: "file", label: "📦 File Upload", desc: "Solvers upload a file (model, archive, etc).", format: "File upload (ZIP, tar.gz, or binary)" },
  { value: "custom", label: "⚙️ Custom", desc: "Define your own submission format.", format: "" },
] as const;

// ─── Form State ─────────────────────────────────────

type FormState = {
  title: string;
  description: string;
  domain: string;
  type: PostChallengeType;
  train: string;
  test: string;
  metric: string;
  container: string;
  reward: string;
  distribution: "winner_take_all" | "top_3" | "proportional";
  deadline: string;
  minimumScore: string;
  disputeWindow: string;
  submissionType: string;
  submissionFormat: string;
  evaluationCriteria: string;
  successDefinition: string;
  idColumn: string;
  labelColumn: string;
};

const defaultPreset = TYPE_CONFIG.reproducibility;

const initialState: FormState = {
  title: "",
  description: "",
  domain: defaultPreset.defaultDomain,
  type: "reproducibility",
  train: "",
  test: "",
  metric: defaultPreset.metricHint,
  container: defaultPreset.container,
  reward: "10",
  distribution: "winner_take_all",
  deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  minimumScore: String(defaultPreset.defaultMinimumScore),
  disputeWindow: "168",
  submissionType: "number",
  submissionFormat: '{"answer": <number>}',
  evaluationCriteria: "",
  successDefinition: "",
  idColumn: "id",
  labelColumn: "prediction",
};

function buildSpec(state: FormState) {
  const train = state.train.trim();
  const test = state.test.trim();
  const dataset =
    train || test
      ? {
        ...(train ? { train } : {}),
        ...(test ? { test } : {}),
      }
      : undefined;

  const presetId = TYPE_CONFIG[state.type].presetId;

  return {
    id: `web-${Date.now()}`,
    preset_id: presetId,
    title: state.title,
    domain: state.domain,
    type: state.type,
    description: state.description,
    dataset,
    scoring: { container: state.container, metric: state.metric },
    reward: {
      total: Number(state.reward),
      distribution: state.distribution,
    },
    deadline: state.deadline,
    minimum_score: Number(state.minimumScore),
    dispute_window_hours: Number(state.disputeWindow),
    evaluation: {
      submission_format: state.submissionFormat || undefined,
      criteria: state.evaluationCriteria || undefined,
      success_definition: state.successDefinition || undefined,
      id_column: state.idColumn || undefined,
      label_column: state.labelColumn || undefined,
    },
    lab_tba: "0x0000000000000000000000000000000000000000",
  };
}

// ─── Helpers ────────────────────────────────────────

function FormField({
  label, hint, children, className,
}: {
  label: string; hint?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`form-field ${className ?? ""}`}>
      <label className="form-label">{label}</label>
      {children}
      {hint ? <span className="form-hint">{hint}</span> : null}
    </div>
  );
}

// ─── Data Upload Field ──────────────────────────────

function DataUploadField({
  value, onChange, uploading, onUpload, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  uploading: boolean;
  onUpload: (file: File) => void;
  placeholder: string;
}) {
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  }

  return (
    <div
      className={`drop-zone ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        className="form-input form-input-mono"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={uploading}
      />
      {uploading ? (
        <span className="drop-zone-hint"><Loader2 size={12} className="animate-spin" /> Uploading...</span>
      ) : (
        <span className="drop-zone-hint"><Upload size={12} /> or drag a file here</span>
      )}
    </div>
  );
}

// ─── Component ──────────────────────────────────────

export function PostClient() {
  const [state, setState] = useState<FormState>(initialState);
  const [status, setStatus] = useState<string>("");
  const [isPosting, setIsPosting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showData, setShowData] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [uploadingField, setUploadingField] = useState<"train" | "test" | null>(null);

  const { isConnected, chainId, address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();

  const rewardValue = Number(state.reward || 0);
  const { feeUsdc: protocolFeeValue, payoutUsdc: winnerPayoutValue } = computeProtocolFee(rewardValue);

  const isCustomType = state.type === "custom" || state.type === "optimization";

  async function handleFileUpload(file: File, field: "train" | "test") {
    setUploadingField(field);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/pin-data", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      const { cid } = (await res.json()) as { cid: string };
      setState((s) => ({ ...s, [field]: cid }));
    } catch (err) {
      setStatus(`Upload failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setUploadingField(null);
    }
  }

  function selectType(t: PostChallengeType) {
    const preset = TYPE_CONFIG[t];
    setState((s) => ({
      ...s,
      type: t,
      container: preset.container,
      metric: preset.metricHint,
      domain: preset.defaultDomain,
      minimumScore: String(preset.defaultMinimumScore),
      evaluationCriteria: preset.scoringTemplate || s.evaluationCriteria,
      // Prediction: default to CSV submission with id + prediction columns
      ...(t === "prediction" ? {
        submissionType: "csv",
        submissionFormat: "CSV with columns: id, prediction",
        idColumn: "id",
        labelColumn: "prediction",
      } : {}),
    }));
  }

  function validateInput() {
    if (!state.title.trim() || !state.description.trim())
      return "Title and description are required.";
    if (!Number.isFinite(rewardValue) || rewardValue <= 0)
      return "Reward must be a positive number.";
    if (rewardValue < 1 || rewardValue > 30)
      return "Reward must be between 1 and 30 USDC.";
    if (!state.container.trim())
      return "Scoring container is required.";
    // Validate container reference
    const containerError = validateScoringContainer(state.container);
    if (containerError)
      return containerError;
    const presetId = TYPE_CONFIG[state.type].presetId;
    const presetIntegrityError = validatePresetIntegrity(presetId, state.container);
    if (presetIntegrityError)
      return presetIntegrityError;

    const disputeWindow = Number(state.disputeWindow);
    if (!Number.isFinite(disputeWindow) || disputeWindow < 0 || disputeWindow > 2160)
      return "Review period must be between 0 and 2160 hours.";
    if (new Date(state.deadline).getTime() <= Date.now())
      return "Deadline must be in the future.";
    return null;
  }

  async function handleSubmit() {
    if (!isConnected) { setStatus("Connect wallet first."); return; }
    if (!FACTORY_ADDRESS || !USDC_ADDRESS) {
      setStatus("Missing NEXT_PUBLIC_HERMES_FACTORY_ADDRESS or NEXT_PUBLIC_HERMES_USDC_ADDRESS.");
      return;
    }
    if (chainId !== CHAIN_ID) { setStatus(`Wrong network. Expected chain id ${CHAIN_ID}.`); return; }
    if (!publicClient) { setStatus("Wallet client is not ready. Reconnect wallet and retry."); return; }
    const error = validateInput();
    if (error) { setStatus(error); return; }

    try {
      setIsPosting(true);
      setStatus("Pinning spec to IPFS...");
      const spec = buildSpec(state);
      if (!address) throw new Error("Wallet address is required to authorize spec pinning.");

      const timestamp = Date.now();
      const specHash = computeSpecHash(spec);
      const message = buildPinSpecMessage({ address, timestamp, specHash });
      const signature = await signMessageAsync({ account: address, message });

      const pinRes = await fetch("/api/pin-spec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec, auth: { address, timestamp, specHash, signature } }),
      });
      if (!pinRes.ok) throw new Error(await pinRes.text());
      const { specCid } = (await pinRes.json()) as { specCid: string };

      const rewardUnits = parseUnits(String(spec.reward.total), 6);
      const minimumScoreWad = parseUnits(String(spec.minimum_score ?? 0), 18);
      const deadlineTs = new Date(spec.deadline).getTime();

      const currentBalance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }) as bigint;
      if (currentBalance < rewardUnits) {
        const missing = rewardUnits - currentBalance;
        throw new Error(
          `Insufficient USDC balance. Need ${formatUsdc(Number(rewardUnits) / 1e6)} USDC, missing ${formatUsdc(Number(missing) / 1e6)} USDC.`,
        );
      }

      const currentAllowance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, FACTORY_ADDRESS],
      }) as bigint;

      if (currentAllowance < rewardUnits) {
        setStatus("Approving USDC allowance...");
        const approveTx = await writeContractAsync({
          account: address,
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [FACTORY_ADDRESS, rewardUnits],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      } else {
        setStatus("USDC already approved, creating challenge...");
      }

      setStatus("Creating challenge on-chain...");
      const createTx = await writeContractAsync({
        account: address,
        address: FACTORY_ADDRESS,
        abi: HermesFactoryAbi,
        functionName: "createChallenge",
        args: [
          specCid, rewardUnits, BigInt(Math.floor(deadlineTs / 1000)),
          BigInt(spec.dispute_window_hours ?? 168), minimumScoreWad,
          DISTRIBUTION_TO_ENUM[spec.reward.distribution as keyof typeof DISTRIBUTION_TO_ENUM] ?? 0,
          "0x0000000000000000000000000000000000000000",
          0n, // maxSubmissions (0 = use off-chain defaults)
          0n, // maxSubmissionsPerSolver (0 = use off-chain defaults)
        ],
      });

      await publicClient.waitForTransactionReceipt({ hash: createTx });
      setStatus("Challenge confirmed on-chain. Accelerating indexer sync...");
      try {
        await accelerateChallengeIndex({ txHash: createTx });
        setStatus(`success: Challenge posted. tx=${createTx}. Indexed immediately.`);
      } catch {
        setStatus(`success: Challenge posted on-chain (tx=${createTx}). Indexer will sync it shortly.`);
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Failed to post challenge.";
      if (message.includes("USDC_TRANSFER_FAILED")) {
        setStatus("createChallenge reverted: USDC transfer failed. Confirm wallet has enough USDC and allowance for the same connected address.");
      } else {
        setStatus(message);
      }
    } finally {
      setIsPosting(false);
    }
  }

  const isSuccess = status.startsWith("success:");

  return (
    <div className="post-form">
      {/* Header */}
      <div className="post-header">
        <div className="post-header-left">
          <h1 className="page-title">Post Bounty</h1>
          <p className="page-subtitle">
            Define a computational challenge and fund it with USDC.
          </p>
        </div>
      </div>

      {/* ── Challenge Type Selector ── */}
      <div className="type-selector">
        {TYPE_OPTIONS.map((key) => {
          const preset = TYPE_CONFIG[key];
            const Icon = TYPE_ICONS[key];
            const active = state.type === key;
            return (
              <button
                key={key}
                type="button"
                className={`type-card ${active ? "active" : ""}`}
                onClick={() => selectType(key)}
              >
                <div className="type-card-check">
                  {active && <Check size={10} strokeWidth={3} />}
                </div>
                <div className="type-card-icon">
                  <Icon size={18} />
                </div>
                <div className="type-card-title">{preset.label}</div>
                <div className="type-card-desc">{preset.description}</div>
              </button>
            );
          })}
      </div>

      {/* ── Section 1: Problem ── */}
      <div className="form-section">
        <div className="form-section-header">
          <span className="form-section-step">1</span>
          <span className="form-section-title">Problem</span>
        </div>
        <div className="form-section-body">
          <div className="form-grid">
            <FormField label="Title">
              <input className="form-input" placeholder="e.g. Find the optimal protein fold"
                value={state.title} onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))} />
            </FormField>
            <FormField label="Domain">
              <select className="form-select" value={state.domain}
                onChange={(e) => setState((s) => ({ ...s, domain: e.target.value }))}>
                <option value="longevity">Longevity</option>
                <option value="drug_discovery">Drug Discovery</option>
                <option value="protein_design">Protein Design</option>
                <option value="omics">Omics</option>
                <option value="neuroscience">Neuroscience</option>
                <option value="other">Other</option>
              </select>
            </FormField>
            <FormField label="Description" className="span-full">
              <textarea className="form-textarea" placeholder="What problem are you trying to solve? What should solvers achieve?"
                value={state.description} onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))} />
            </FormField>
          </div>
        </div>
      </div>

      {/* ── Section 2: Submission & Evaluation ── */}
      <div className="form-section">
        <div className="form-section-header">
          <span className="form-section-step">2</span>
          <span className="form-section-title">Submission &amp; Evaluation</span>
        </div>
        <div className="form-section-body">
          <div className="form-grid">
            <FormField label="Submission type" hint={SUBMISSION_TYPES.find(t => t.value === state.submissionType)?.desc ?? ""}>
              <select className="form-select" value={state.submissionType}
                onChange={(e) => {
                  const st = SUBMISSION_TYPES.find(t => t.value === e.target.value);
                  setState((s) => ({ ...s, submissionType: e.target.value, submissionFormat: st?.format ?? "" }));
                }}>
                {SUBMISSION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </FormField>
            {state.submissionType === "custom" ? (
              <FormField label="Custom format" hint="Describe the expected submission structure">
                <input className="form-input" placeholder="e.g. ZIP containing model.pkl and predictions.csv"
                  value={state.submissionFormat} onChange={(e) => setState((s) => ({ ...s, submissionFormat: e.target.value }))} />
              </FormField>
            ) : (
              <FormField label="Validation rules" hint="What makes a submission valid? (plain English)">
                <input className="form-input" placeholder="e.g. Must be a positive integer"
                  value={state.successDefinition} onChange={(e) => setState((s) => ({ ...s, successDefinition: e.target.value }))} />
              </FormField>
            )}

            <div className="span-full" style={{ borderTop: "1px solid var(--border-subtle)", margin: "0.25rem 0" }} />

            {/* Type-specific fields */}
            {state.type === "reproducibility" && (
              <div className="span-full" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <FormField label="Scoring description (for humans)" hint="">
                  <textarea className="form-textarea" placeholder="Describe the scoring logic for solvers..."
                    value={state.evaluationCriteria} onChange={(e) => setState((s) => ({ ...s, evaluationCriteria: e.target.value }))} />
                </FormField>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "var(--surface-inset)", borderRadius: "6px", fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>
                    <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>Authoritative evaluator:</span>
                    <span style={{ color: "var(--text-primary)" }}>{engineDisplayName(state.container)}</span>
                  </div>
                  <p style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: 0, fontStyle: "italic" }}>
                    This description is not enforced. The scorer container is the source of truth.
                  </p>
                </div>
              </div>
            )}

            {state.type === "optimization" && (
              <>
                <FormField label="Scoring container" hint="Your OCI image that runs the simulation" className="span-full">
                  <input className="form-input form-input-mono"
                    placeholder="ghcr.io/org/scorer@sha256:..."
                    value={state.container}
                    onChange={(e) => setState((s) => ({ ...s, container: e.target.value }))}
                  />
                </FormField>
                <FormField label="Scoring description (for humans)" hint="" className="span-full">
                  <textarea className="form-textarea" placeholder="Describe the objective function and how submissions are evaluated..."
                    value={state.evaluationCriteria} onChange={(e) => setState((s) => ({ ...s, evaluationCriteria: e.target.value }))} />
                </FormField>
                <p className="span-full" style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: 0, fontStyle: "italic" }}>
                  This description is not enforced. The scorer container is the source of truth.
                </p>
              </>
            )}

            {state.type === "prediction" && (
              <>
                <FormField label="ID column" hint="Column name for row identifiers in test.csv">
                  <input className="form-input form-input-mono" placeholder="id"
                    value={state.idColumn} onChange={(e) => setState((s) => ({ ...s, idColumn: e.target.value }))} />
                </FormField>
                <FormField label="Label column" hint="Column name solvers must predict">
                  <input className="form-input form-input-mono" placeholder="prediction"
                    value={state.labelColumn} onChange={(e) => setState((s) => ({ ...s, labelColumn: e.target.value }))} />
                </FormField>
                <FormField label="Metric" hint={METRIC_OPTIONS.find(m => m.value === state.metric)?.hint ?? ""}>
                  <select className="form-select" value={state.metric}
                    onChange={(e) => {
                      const m = METRIC_OPTIONS.find(o => o.value === e.target.value);
                      setState((s) => ({
                        ...s,
                        metric: e.target.value,
                        evaluationCriteria: m ? `Evaluated by ${m.label}. ${m.hint}.` : s.evaluationCriteria,
                      }));
                    }}>
                    {METRIC_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Scoring detail" hint="Additional context (optional)">
                  <input className="form-input" placeholder="e.g. Evaluated on held-out test split"
                    value={state.evaluationCriteria} onChange={(e) => setState((s) => ({ ...s, evaluationCriteria: e.target.value }))} />
                </FormField>
                <div className="span-full" style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "var(--surface-inset)", borderRadius: "6px", fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>
                    <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>Authoritative evaluator:</span>
                    <span style={{ color: "var(--text-primary)" }}>{engineDisplayName(state.container)}</span>
                  </div>
                  <p style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: 0, fontStyle: "italic" }}>
                    This description is not enforced. The scorer container is the source of truth.
                  </p>
                </div>
              </>
            )}

            {state.type === "docking" && (
              <>
                <FormField label="Metric" hint={METRIC_OPTIONS.find(m => m.value === state.metric)?.hint ?? ""}>
                  <select className="form-select" value={state.metric}
                    onChange={(e) => {
                      const m = METRIC_OPTIONS.find(o => o.value === e.target.value);
                      setState((s) => ({
                        ...s,
                        metric: e.target.value,
                        evaluationCriteria: m ? `Evaluated by ${m.label}. ${m.hint}.` : s.evaluationCriteria,
                      }));
                    }}>
                    {METRIC_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Scoring detail" hint="Additional context (optional)">
                  <input className="form-input" placeholder="e.g. Docking protocol, target PDB ID"
                    value={state.evaluationCriteria} onChange={(e) => setState((s) => ({ ...s, evaluationCriteria: e.target.value }))} />
                </FormField>
                <div className="span-full" style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "var(--surface-inset)", borderRadius: "6px", fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>
                    <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>Authoritative evaluator:</span>
                    <span style={{ color: "var(--text-primary)" }}>{engineDisplayName(state.container)}</span>
                  </div>
                  <p style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: 0, fontStyle: "italic" }}>
                    This description is not enforced. The scorer container is the source of truth.
                  </p>
                </div>
              </>
            )}

            {state.type === "custom" && (
              <>
                <FormField label="Scoring container" hint="Your OCI image reference" className="span-full">
                  <input className="form-input form-input-mono"
                    placeholder="ghcr.io/org/scorer@sha256:..."
                    value={state.container}
                    onChange={(e) => setState((s) => ({ ...s, container: e.target.value }))}
                  />
                </FormField>
                <FormField label="Scoring description (for humans)" hint="" className="span-full">
                  <textarea className="form-textarea" placeholder="Explain the scoring logic for solvers..."
                    value={state.evaluationCriteria} onChange={(e) => setState((s) => ({ ...s, evaluationCriteria: e.target.value }))} />
                </FormField>
                <p className="span-full" style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", margin: 0, fontStyle: "italic" }}>
                  This description is not enforced. The scorer container is the source of truth.
                </p>
              </>
            )}

            <FormField label="Winner selection" hint={WINNER_LABELS[state.distribution] ?? ""}>
              <select className="form-select" value={state.distribution}
                onChange={(e) => setState((s) => ({ ...s, distribution: e.target.value as FormState["distribution"] }))}>
                <option value="winner_take_all">Winner Take All</option>
                <option value="top_3">Top 3</option>
                <option value="proportional">Proportional</option>
              </select>
            </FormField>
          </div>
        </div>
      </div>

      {/* ── Data (optional, collapsed) ── */}
      <button
        type="button"
        className={`advanced-toggle ${showData ? "open" : ""}`}
        onClick={() => setShowData(!showData)}
      >
        <Database size={14} />
        <ChevronRight size={14} />
        Data (optional)
        <span className="form-hint" style={{ marginLeft: "auto" }}>
          Public files, evaluation dataset
        </span>
      </button>

      {showData && (
        <div className="advanced-body" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <FormField label="Public inputs" hint="Files or data available to solvers">
            <DataUploadField
              value={state.train}
              onChange={(v) => setState((s) => ({ ...s, train: v }))}
              uploading={uploadingField === "train"}
              onUpload={(file) => handleFileUpload(file, "train")}
              placeholder="ipfs://... or https://... (optional)"
            />
          </FormField>
          <FormField label="Evaluation dataset" hint="Used during scoring (visible on IPFS)">
            <DataUploadField
              value={state.test}
              onChange={(v) => setState((s) => ({ ...s, test: v }))}
              uploading={uploadingField === "test"}
              onUpload={(file) => handleFileUpload(file, "test")}
              placeholder="ipfs://... or https://... (optional)"
            />
          </FormField>
        </div>
      )}

      {/* ── Section 3: Reward & Timeline ── */}
      <div className="form-section">
        <div className="form-section-header">
          <span className="form-section-step">3</span>
          <span className="form-section-title">Reward &amp; Timeline</span>
        </div>
        <div className="form-section-body">
          <div className="form-grid">
            <FormField label="Reward (USDC)" hint="Between 1 and 30 USDC">
              <input className="form-input form-input-mono" type="number" min={1} max={30}
                value={state.reward} onChange={(e) => setState((s) => ({ ...s, reward: e.target.value }))} />
            </FormField>
            <FormField label="Deadline">
              <input className="form-input" type="datetime-local"
                value={state.deadline.slice(0, 16)}
                onChange={(e) => {
                  const ts = Date.parse(e.target.value);
                  if (Number.isFinite(ts)) setState((s) => ({ ...s, deadline: new Date(ts).toISOString() }));
                }} />
            </FormField>
            <FormField label="Review period" hint="Funds are locked until review period ends (0–2160 hours)">
              <select className="form-select" value={state.disputeWindow}
                onChange={(e) => setState((s) => ({ ...s, disputeWindow: e.target.value }))}>
                <option value="0">Instant (0h) — Testnet only</option>
                <option value="1">1 hour — Testing</option>
                <option value="168">7 days (168h) — Standard</option>
                <option value="336">14 days (336h)</option>
                <option value="720">30 days (720h)</option>
                <option value="1440">60 days (1440h)</option>
                <option value="2160">90 days (2160h) — Maximum</option>
              </select>
            </FormField>
            {state.disputeWindow === "0" && (
              <div className="span-full" style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "#fff3cd", borderRadius: "6px", fontSize: "0.75rem", color: "#856404", border: "1px solid #ffc107" }}>
                <AlertCircle size={14} />
                <span>⚠️ Instant review (0h) means <strong>no dispute window</strong>. Funds are released immediately after scoring. Use only for testing.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Scoring Engine & Threshold ── */}
      <button
        type="button"
        className={`advanced-toggle ${showAdvanced ? "open" : ""}`}
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        <Settings2 size={14} />
        <ChevronRight size={14} />
        Scoring Engine &amp; Threshold
        <span className="form-hint" style={{ marginLeft: "auto" }}>
          Container image, minimum score
        </span>
      </button>

      {showAdvanced && (
        <div className="advanced-body" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <FormField label="Scoring container" hint={isCustomType ? "Provide your own OCI image reference." : "Managed by preset. Switch to Custom to override."}>
            <input className="form-input form-input-mono"
              placeholder="ghcr.io/org/image@sha256:..."
              value={state.container}
              onChange={(e) => setState((s) => ({ ...s, container: e.target.value }))}
              readOnly={!isCustomType}
              style={!isCustomType ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
            />
          </FormField>
          <FormField label="Minimum score" hint="Submissions below this are rejected (0 = no threshold)">
            <input className="form-input form-input-mono" type="number" min={0} max={100}
              placeholder="0"
              value={state.minimumScore}
              onChange={(e) => setState((s) => ({ ...s, minimumScore: e.target.value }))}
            />
          </FormField>
        </div>
      )}

      {/* ── Challenge Summary ── */}
      <div className="cost-card">
        <h3 className="cost-card-title">
          <Eye size={14} /> Challenge Summary
        </h3>
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-secondary)" }}>Type</span>
          <span className="cost-row-value">{TYPE_CONFIG[state.type].label}</span>
        </div>
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-secondary)" }}>Deposit</span>
          <span className="cost-row-value accent">{formatUsdc(rewardValue)} USDC</span>
        </div>
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-tertiary)" }}>Protocol fee (5%)</span>
          <span className="cost-row-value" style={{ color: "var(--text-tertiary)" }}>{formatUsdc(protocolFeeValue)} USDC</span>
        </div>
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-tertiary)" }}>Net winner payout</span>
          <span className="cost-row-value" style={{ color: "var(--text-tertiary)" }}>{formatUsdc(winnerPayoutValue)} USDC</span>
        </div>
        <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "0.5rem 0" }} />
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-tertiary)" }}>Deadline</span>
          <span className="cost-row-value" style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}>
            {new Date(state.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </div>
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-tertiary)" }}>Review period</span>
          <span className="cost-row-value" style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}>{state.disputeWindow}h</span>
        </div>
        <div className="cost-row">
          <span className="cost-row-label" style={{ color: "var(--text-tertiary)" }}>Winner</span>
          <span className="cost-row-value" style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}>{state.distribution.replace(/_/g, " ")}</span>
        </div>
        {state.container && (
          <div className="cost-row">
            <span className="cost-row-label" style={{ color: "var(--text-tertiary)" }}>Engine</span>
            <span className="cost-row-value" style={{ color: "var(--text-secondary)", fontSize: "0.72rem", fontFamily: "var(--font-mono)" }}>
              {state.container.length > 40 ? state.container.slice(0, 40) + "…" : state.container}
            </span>
          </div>
        )}
      </div>

      {/* ── Submit ── */}
      <div className="post-submit-row">
        <button
          type="button"
          disabled={isPosting}
          onClick={() => {
            const error = validateInput();
            if (error) { setStatus(error); return; }
            setShowPreview(true);
          }}
          className="dash-btn dash-btn-primary"
          style={{ padding: "0.65rem 1.5rem", fontSize: "0.85rem", opacity: isPosting ? 0.6 : 1 }}
        >
          {isPosting ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
          {isPosting ? "Posting..." : "Review & Post"}
        </button>
        {!isConnected && (
          <span className="form-hint">
            Connect wallet to submit →
          </span>
        )}
      </div>

      {/* ── Status ── */}
      {status ? (
        <div className={`post-status ${isSuccess ? "success" : ""}`}>
          {isSuccess
            ? <CheckCircle size={16} style={{ color: "var(--color-success)", flexShrink: 0, marginTop: 2 }} />
            : <AlertCircle size={16} style={{ color: "var(--text-tertiary)", flexShrink: 0, marginTop: 2 }} />
          }
          <p>
            {isSuccess ? status.replace("success: ", "") : status}
          </p>
        </div>
      ) : null}

      {/* ── Preview Overlay ── */}
      {showPreview && (
        <div className="preview-overlay" onClick={() => setShowPreview(false)}>
          <div className="preview-card" onClick={(e) => e.stopPropagation()}>
            <div className="preview-card-header">
              <h3 style={{ margin: 0, fontSize: "0.95rem", fontFamily: "var(--font-heading)" }}>
                <Eye size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                Review Challenge
              </h3>
              <button type="button" onClick={() => setShowPreview(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)" }}>
                <X size={18} />
              </button>
            </div>
            <div className="preview-summary">
              <div className="preview-row"><span className="preview-label">Title</span><span className="preview-value">{state.title || "—"}</span></div>
              <div className="preview-row"><span className="preview-label">Domain</span><span className="preview-value">{state.domain}</span></div>
              <div className="preview-row"><span className="preview-label">Type</span><span className="preview-value">{TYPE_CONFIG[state.type].label}</span></div>
              {state.description && <div className="preview-row span-full"><span className="preview-label">Description</span><span className="preview-value">{state.description}</span></div>}
              <div className="preview-divider" />
              <div className="preview-row"><span className="preview-label">Container</span><span className="preview-value" style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{state.container || "—"}</span></div>
              {state.metric && <div className="preview-row"><span className="preview-label">Metric</span><span className="preview-value">{state.metric}</span></div>}
              {state.type === "prediction" && state.idColumn && <div className="preview-row"><span className="preview-label">ID column</span><span className="preview-value" style={{ fontFamily: "monospace" }}>{state.idColumn}</span></div>}
              {state.type === "prediction" && state.labelColumn && <div className="preview-row"><span className="preview-label">Label column</span><span className="preview-value" style={{ fontFamily: "monospace" }}>{state.labelColumn}</span></div>}
              {state.submissionFormat && <div className="preview-row"><span className="preview-label">Submission format</span><span className="preview-value">{state.submissionFormat}</span></div>}
              {state.successDefinition && <div className="preview-row"><span className="preview-label">Success criteria</span><span className="preview-value">{state.successDefinition}</span></div>}
              {state.evaluationCriteria && <div className="preview-row span-full"><span className="preview-label">Evaluation</span><span className="preview-value">{state.evaluationCriteria}</span></div>}
              <div className="preview-divider" />
              <div className="preview-row"><span className="preview-label">Reward</span><span className="preview-value">{state.reward} USDC</span></div>
              <div className="preview-row"><span className="preview-label">Distribution</span><span className="preview-value">{state.distribution.replace(/_/g, " ")}</span></div>
              <div className="preview-row"><span className="preview-label">Deadline</span><span className="preview-value">{new Date(state.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></div>
              <div className="preview-row"><span className="preview-label">Review period</span><span className="preview-value">{state.disputeWindow}h</span></div>

            </div>
            <div className="preview-actions">
              <button type="button" onClick={() => setShowPreview(false)}
                className="dash-btn" style={{ fontSize: "0.8rem" }}>
                ← Edit
              </button>
              <button type="button" disabled={isPosting}
                onClick={() => { setShowPreview(false); handleSubmit(); }}
                className="dash-btn dash-btn-primary" style={{ fontSize: "0.8rem" }}>
                {isPosting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                Confirm &amp; Post On-Chain
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
