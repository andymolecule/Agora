import { AlertCircle } from "lucide-react";
import type { FormState, UploadField } from "../post-client-model";
import {
  DataUploadField,
  FormField,
  PipelineVisual,
  SectionHeader,
} from "../post-form-primitives";

export function ChallengeMaterialsSection({
  state,
  uploadingField,
  fileNames,
  onUpload,
  onUploadValueChange,
}: {
  state: FormState;
  uploadingField: UploadField | null;
  fileNames: Record<string, string>;
  onUpload: (file: File, field: UploadField) => void;
  onUploadValueChange: (field: UploadField, value: string) => void;
}) {
  return (
    <div className="form-section">
      <SectionHeader step={2} title="Public Challenge Materials" />
      <div className="form-section-body">
        <div className="poster-step-intro">
          <p className="poster-step-intro-title">
            What challenge materials will Agora publish with this bounty?
          </p>
          <p className="poster-step-intro-copy">
            Upload the public datasets and benchmark artifacts solvers will work
            from. This step defines the shared materials attached to the
            challenge.
          </p>
        </div>
        <PipelineVisual type={state.type} />
        <div className="form-grid">
          {state.type === "prediction" ? (
            <>
              <FormField
                label="Public training dataset"
                hint="Public labeled data solvers use to fit and validate their models"
              >
                <DataUploadField
                  value={state.train}
                  onChange={(value) => onUploadValueChange("train", value)}
                  uploading={uploadingField === "train"}
                  onUpload={(file) => onUpload(file, "train")}
                  placeholder="ipfs://... or https://..."
                  fileName={fileNames.train}
                />
              </FormField>
              <FormField
                label="Public evaluation inputs"
                hint="Public rows solvers generate predictions for"
              >
                <DataUploadField
                  value={state.test}
                  onChange={(value) => onUploadValueChange("test", value)}
                  uploading={uploadingField === "test"}
                  onUpload={(file) => onUpload(file, "test")}
                  placeholder="ipfs://... or https://..."
                  fileName={fileNames.test}
                />
              </FormField>
              <FormField
                label="Benchmark scoring targets"
                hint="Ground-truth values Agora uses to score submitted predictions once the submission window closes."
                className="span-full"
              >
                <DataUploadField
                  value={state.hiddenLabels}
                  onChange={(value) =>
                    onUploadValueChange("hiddenLabels", value)
                  }
                  uploading={uploadingField === "hiddenLabels"}
                  onUpload={(file) => onUpload(file, "hiddenLabels")}
                  placeholder="ipfs://... or https://..."
                  fileName={fileNames.hiddenLabels}
                />
              </FormField>
              <div className="span-full poster-visibility-note">
                <AlertCircle size={14} />
                <span>
                  Current prediction bounties on Agora are benchmark-style.
                  These targets are published with the challenge materials and
                  become the official benchmark Agora-operated scoring uses
                  after submissions close.
                </span>
              </div>
            </>
          ) : null}

          {state.type === "reproducibility" ? (
            <>
              <FormField
                label="Public source dataset"
                hint="The source data and inputs solvers must reproduce from"
              >
                <DataUploadField
                  value={state.train}
                  onChange={(value) => onUploadValueChange("train", value)}
                  uploading={uploadingField === "train"}
                  onUpload={(file) => onUpload(file, "train")}
                  placeholder="ipfs://... or https://..."
                  fileName={fileNames.train}
                />
              </FormField>
              <FormField
                label="Official reference output"
                hint="This CSV is posted with the challenge and becomes the public reference benchmark the official scorer compares submissions against."
              >
                <DataUploadField
                  value={state.test}
                  onChange={(value) => onUploadValueChange("test", value)}
                  uploading={uploadingField === "test"}
                  onUpload={(file) => onUpload(file, "test")}
                  placeholder="ipfs://... or https://..."
                  fileName={fileNames.test}
                />
              </FormField>
              <div className="span-full poster-visibility-note">
                <AlertCircle size={14} />
                <span>
                  Reproducibility challenges are public benchmark tasks. Both
                  the source dataset and the official reference output are
                  published with the challenge so solvers can independently
                  understand the target artifact.
                </span>
              </div>
            </>
          ) : null}

          {state.type === "optimization" ? (
            <FormField
              label="Evaluation bundle"
              hint="Config and data your scorer container needs"
              className="span-full"
            >
              <DataUploadField
                value={state.train}
                onChange={(value) => onUploadValueChange("train", value)}
                uploading={uploadingField === "train"}
                onUpload={(file) => onUpload(file, "train")}
                placeholder="ipfs://... or https://..."
                fileName={fileNames.train}
              />
            </FormField>
          ) : null}

          {state.type === "docking" ? (
            <>
              <FormField
                label="Target structure"
                hint="Protein target (PDB file or reference data for the scorer)"
              >
                <DataUploadField
                  value={state.train}
                  onChange={(value) => onUploadValueChange("train", value)}
                  uploading={uploadingField === "train"}
                  onUpload={(file) => onUpload(file, "train")}
                  placeholder="ipfs://... or https://..."
                  fileName={fileNames.train}
                />
              </FormField>
              <FormField
                label="Ligand set"
                hint="Molecules to dock - solvers rank these by predicted binding affinity"
              >
                <DataUploadField
                  value={state.test}
                  onChange={(value) => onUploadValueChange("test", value)}
                  uploading={uploadingField === "test"}
                  onUpload={(file) => onUpload(file, "test")}
                  placeholder="ipfs://... or https://..."
                  fileName={fileNames.test}
                />
              </FormField>
            </>
          ) : null}

          {state.type === "red_team" ? (
            <>
              <FormField
                label="Baseline data"
                hint="Data showing normal model behavior - solvers study this to craft adversarial inputs"
                className="span-full"
              >
                <DataUploadField
                  value={state.train}
                  onChange={(value) => onUploadValueChange("train", value)}
                  uploading={uploadingField === "train"}
                  onUpload={(file) => onUpload(file, "train")}
                  placeholder="ipfs://... or https://..."
                  fileName={fileNames.train}
                />
              </FormField>
              <FormField
                label="Reference outputs (optional)"
                hint="Baseline performance the scorer compares degradation against"
                className="span-full"
              >
                <DataUploadField
                  value={state.test}
                  onChange={(value) => onUploadValueChange("test", value)}
                  uploading={uploadingField === "test"}
                  onUpload={(file) => onUpload(file, "test")}
                  placeholder="ipfs://... or https://..."
                  fileName={fileNames.test}
                />
              </FormField>
            </>
          ) : null}

          {state.type === "custom" ? (
            <>
              <FormField
                label="Public inputs"
                hint="Files or data available to solvers"
              >
                <DataUploadField
                  value={state.train}
                  onChange={(value) => onUploadValueChange("train", value)}
                  uploading={uploadingField === "train"}
                  onUpload={(file) => onUpload(file, "train")}
                  placeholder="ipfs://... or https://..."
                  fileName={fileNames.train}
                />
              </FormField>
              <FormField
                label="Evaluation dataset"
                hint="Used during scoring (visible on IPFS)"
              >
                <DataUploadField
                  value={state.test}
                  onChange={(value) => onUploadValueChange("test", value)}
                  uploading={uploadingField === "test"}
                  onUpload={(file) => onUpload(file, "test")}
                  placeholder="ipfs://... or https://..."
                  fileName={fileNames.test}
                />
              </FormField>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
