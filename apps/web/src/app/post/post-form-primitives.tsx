import type { ChallengeType } from "@agora/common";
import { CheckCircle, Loader2, Upload, Wallet, X } from "lucide-react";
import { motion } from "motion/react";
import {
  type ChangeEvent,
  type DragEvent,
  Fragment,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { PIPELINE_FLOWS } from "./post-client-model";

export function PipelineVisual({ type }: { type: ChallengeType }) {
  const flow = PIPELINE_FLOWS[type];
  const icons = {
    poster: Upload,
    solver: Wallet,
    scorer: CheckCircle,
  } as const;

  return (
    <div className="pipeline-diagram">
      <div className="pipeline-visual">
        {flow.stages.map((stage, index) => {
          const Icon = icons[stage.tone];

          return (
            <Fragment key={stage.title}>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + index * 0.08 }}
                className={`pipeline-node pipeline-node-${stage.tone}`}
              >
                <div className="pipeline-node-header">
                  <div className={`pipeline-icon pipeline-icon-${stage.tone}`}>
                    <Icon size={18} />
                  </div>
                  <div className="pipeline-title">{stage.title}</div>
                </div>
                <div className="pipeline-divider" />
                <div className="pipeline-action">{stage.action}</div>
                <div className="pipeline-schema">
                  <span
                    className={`pipeline-schema-prefix pipeline-schema-prefix-${stage.tone}`}
                  >
                    {stage.schemaLabel}:
                  </span>
                  <span className="pipeline-schema-value">
                    {stage.schemaValue}
                  </span>
                </div>
              </motion.div>
              {index < flow.stages.length - 1 ? (
                <div className="pipeline-arrow" aria-hidden="true">
                  <div className="pipeline-arrow-line" />
                  <div className="pipeline-arrow-head" />
                </div>
              ) : null}
            </Fragment>
          );
        })}
        <div className="pipeline-visual-summary">{flow.helper}</div>
      </div>
      <div className="pipeline-diagram-copy">
        {flow.systemNote ? (
          <p className="pipeline-system-note">{flow.systemNote}</p>
        ) : null}
      </div>
    </div>
  );
}

export function SectionHeader({
  step,
  title,
  totalSteps = 6,
}: {
  step: number;
  title: string;
  totalSteps?: number;
}) {
  return (
    <div className="form-section-header">
      <div className="form-section-heading">
        <span className="form-section-step">{step}</span>
        <span className="form-section-title">{title}</span>
      </div>
      <span className="form-section-meta">
        Step {step} of {totalSteps}
      </span>
    </div>
  );
}

export function FormField({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`form-field ${className ?? ""}`}>
      <span className="form-label">{label}</span>
      {children}
      {hint ? <span className="form-hint">{hint}</span> : null}
    </div>
  );
}

export function ChoiceField<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  className,
  variant = "default",
}: {
  label: string;
  hint?: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  onChange: (next: T) => void;
  className?: string;
  variant?: "default" | "compact";
}) {
  return (
    <fieldset
      className={`form-field ${className ?? ""}`}
      style={{ border: "none", margin: 0, minInlineSize: 0, padding: 0 }}
    >
      <legend className="form-label">{label}</legend>
      <div className={`choice-grid ${variant === "compact" ? "compact" : ""}`}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              className={`choice-card ${variant === "compact" ? "compact" : ""} ${active ? "active" : ""}`}
              onClick={() => onChange(option.value)}
            >
              <span className="choice-card-title">{option.label}</span>
              {option.hint ? (
                <span className="choice-card-hint">{option.hint}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {hint ? <span className="form-hint">{hint}</span> : null}
    </fieldset>
  );
}

export function DataUploadField({
  value,
  onChange,
  uploading,
  onUpload,
  placeholder,
  fileName,
}: {
  value: string;
  onChange: (value: string) => void;
  uploading: boolean;
  onUpload: (file: File) => void;
  placeholder: string;
  fileName?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onUpload(file);
  }

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const hasValue = value.trim().length > 0;
  const isIpfs =
    value.startsWith("ipfs://") ||
    /^Qm[A-Za-z0-9]{44}/.test(value) ||
    /^bafy[A-Za-z0-9]+/.test(value);

  if (hasValue && !uploading) {
    return (
      <div className="drop-zone has-value">
        <div className="drop-zone-filled">
          <CheckCircle size={14} className="drop-zone-filled-icon" />
          <span className="drop-zone-filled-name">
            {fileName || (isIpfs ? `${value.slice(0, 24)}...` : value)}
          </span>
          <button
            type="button"
            className="drop-zone-clear"
            onClick={() => onChange("")}
            aria-label="Clear"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`drop-zone-area ${dragging ? "dragging" : ""} ${uploading ? "uploading" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        id={fileInputId}
        ref={fileInputRef}
        type="file"
        className="drop-zone-file-input"
        onChange={handleFileSelect}
        tabIndex={-1}
      />
      {uploading ? (
        <div className="drop-zone-copy">
          <Loader2 size={20} className="animate-spin drop-zone-area-icon" />
          <span className="drop-zone-area-label">
            Uploading and pinning to IPFS
          </span>
          <span className="drop-zone-area-sub">
            This usually completes in a few seconds.
          </span>
        </div>
      ) : (
        <>
          <label className="drop-zone-copy" htmlFor={fileInputId}>
            <Upload size={20} className="drop-zone-area-icon" />
            <span className="drop-zone-area-label">
              Drop a file or click to upload
            </span>
            <span className="drop-zone-area-sub">
              CSV works best here. You can also paste an IPFS or HTTPS link
              below.
            </span>
          </label>
          <input
            className="drop-zone-url-input"
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const file = event.dataTransfer.files[0];
              if (file) onUpload(file);
            }}
          />
        </>
      )}
    </div>
  );
}
