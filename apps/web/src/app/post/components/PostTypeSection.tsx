import type { ChallengeType } from "@agora/common";
import {
  BarChart3,
  Check,
  FlaskConical,
  Settings2,
  ShieldAlert,
} from "lucide-react";
import {
  AVAILABLE_TYPE_OPTIONS,
  COMING_SOON_TYPE_OPTIONS,
  TYPE_CONFIG,
} from "../post-client-model";

const TYPE_ICONS: Record<ChallengeType, typeof FlaskConical> = {
  prediction: BarChart3,
  optimization: FlaskConical,
  reproducibility: FlaskConical,
  docking: FlaskConical,
  red_team: ShieldAlert,
  custom: Settings2,
};

export function PostTypeSection({
  type,
  onSelectType,
}: {
  type: ChallengeType;
  onSelectType: (type: ChallengeType) => void;
}) {
  function renderTypeCard(
    key: ChallengeType,
    { disabled = false }: { disabled?: boolean } = {},
  ) {
    const preset = TYPE_CONFIG[key];
    const Icon = TYPE_ICONS[key];
    const active = !disabled && type === key;

    return (
      <button
        key={key}
        type="button"
        className={`type-card ${active ? "active" : ""} ${disabled ? "disabled" : ""}`}
        onClick={() => {
          if (!disabled) onSelectType(key);
        }}
        disabled={disabled}
      >
        <div className="type-card-check">
          {active ? <Check size={10} strokeWidth={3} /> : null}
        </div>
        <div className="type-card-icon">
          <Icon size={18} />
        </div>
        <div className="type-card-title-row">
          <div className="type-card-title">{preset.label}</div>
          {disabled ? (
            <span className="type-card-status">Coming soon</span>
          ) : (
            <span className="type-card-status available">Available now</span>
          )}
        </div>
        <div className="type-card-desc">
          {preset.description}
          {disabled
            ? " Self-serve posting is not open for this workflow yet."
            : ""}
        </div>
      </button>
    );
  }

  return (
    <>
      <div className="type-group">
        <div className="type-group-header">
          <div className="type-group-title">Available now</div>
          <p className="type-group-copy">
            Start with the workflows that are fully self-serve and ready for
            real poster and solver use today.
          </p>
        </div>
        <div className="type-selector type-selector-primary">
          {AVAILABLE_TYPE_OPTIONS.map((key) => renderTypeCard(key))}
        </div>
      </div>

      <div className="type-group type-group-muted">
        <div className="type-group-header">
          <div className="type-group-title">Coming soon</div>
          <p className="type-group-copy">
            These workflows still need additional scorer and product work before
            self-serve posting opens.
          </p>
        </div>
        <div className="type-selector type-selector-muted">
          {COMING_SOON_TYPE_OPTIONS.map((key) =>
            renderTypeCard(key, { disabled: true }),
          )}
        </div>
      </div>
    </>
  );
}
