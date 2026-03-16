import { Tag, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import {
  type FormState,
  MARKETPLACE_CATEGORY_OPTIONS,
  TYPE_FORM_COPY,
} from "../post-client-model";
import { ChoiceField, FormField, SectionHeader } from "../post-form-primitives";

export function ScientificBriefSection({
  state,
  setState,
  tagInput,
  setTagInput,
  addTag,
  removeTag,
}: {
  state: FormState;
  setState: Dispatch<SetStateAction<FormState>>;
  tagInput: string;
  setTagInput: Dispatch<SetStateAction<string>>;
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
}) {
  const scientistCopy =
    TYPE_FORM_COPY[state.type as "reproducibility" | "prediction"] ??
    TYPE_FORM_COPY.reproducibility;

  return (
    <div className="form-section">
      <SectionHeader step={1} title="Scientific Brief" />
      <div className="form-section-body">
        <div className="form-grid">
          <FormField label="Bounty title" className="span-full">
            <input
              className="form-input"
              placeholder={scientistCopy.titlePlaceholder}
              value={state.title}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </FormField>
          <FormField label="Challenge brief" className="span-full">
            <textarea
              className="form-textarea"
              placeholder={scientistCopy.descriptionPlaceholder}
              value={state.description}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </FormField>
          <FormField
            label="Reference paper or protocol link (optional)"
            hint="Link the publication, methods page, notebook, or protocol that defines the target artifact."
            className="span-full"
          >
            <input
              className="form-input"
              placeholder="https://..."
              value={state.referenceLink}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  referenceLink: event.target.value,
                }))
              }
            />
          </FormField>
          <div className="span-full poster-secondary-panel">
            <div className="poster-secondary-panel-header">
              <span className="poster-secondary-eyebrow">
                Discovery metadata (optional)
              </span>
              <span className="poster-secondary-copy">
                Helps people find the challenge on Agora.
                <br />
                Does not affect scoring, ranking, or payout.
              </span>
            </div>
            <div className="poster-secondary-panel-body">
              <ChoiceField
                label="Marketplace category"
                value={state.domain}
                options={MARKETPLACE_CATEGORY_OPTIONS}
                onChange={(next) =>
                  setState((current) => ({ ...current, domain: next }))
                }
                className="span-full"
                variant="compact"
              />
              <FormField label="Keywords (optional)" className="span-full">
                <div
                  className="form-input"
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.35rem",
                    alignItems: "center",
                    minHeight: "2.5rem",
                    padding: "0.4rem 0.65rem",
                  }}
                >
                  {state.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        padding: "0.2rem 0.5rem",
                        borderRadius: "12px",
                        background: "#FAFAFA",
                        fontSize: "0.72rem",
                        color: "var(--text-secondary)",
                        border: "1px solid #E5E7EB",
                      }}
                    >
                      <Tag size={10} />
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                          color: "var(--text-tertiary)",
                          lineHeight: 1,
                          display: "flex",
                        }}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  <input
                    style={{
                      flex: 1,
                      minWidth: "120px",
                      border: "none",
                      padding: "0.25rem 0",
                      fontSize: "0.8rem",
                      background: "transparent",
                      outline: "none",
                      color: "var(--text-primary)",
                    }}
                    placeholder={
                      state.tags.length === 0
                        ? `${scientistCopy.tagPlaceholder} - press Enter to add`
                        : "Add keyword... press Enter to add"
                    }
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        (event.key === "Enter" || event.key === ",") &&
                        tagInput.trim()
                      ) {
                        event.preventDefault();
                        addTag(tagInput);
                      }
                      if (
                        event.key === "Backspace" &&
                        !tagInput &&
                        state.tags.length > 0
                      ) {
                        const lastTag = state.tags.at(-1);
                        if (lastTag) removeTag(lastTag);
                      }
                    }}
                    onBlur={() => {
                      if (tagInput.trim()) addTag(tagInput);
                    }}
                  />
                </div>
              </FormField>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
