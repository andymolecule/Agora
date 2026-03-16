import { parseCsvHeaders } from "@agora/common";
import { useState } from "react";
import {
  AVAILABLE_TYPE_OPTIONS,
  type FormState,
  TYPE_CONFIG,
  type UploadField,
  initialState,
} from "./post-client-model";

function readCsvHeader(file: File): Promise<string[]> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(parseCsvHeaders(String(reader.result ?? "")));
    };
    reader.onerror = () => resolve([]);
    reader.readAsText(file.slice(0, 4096));
  });
}

async function pinDataFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/pin-data", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const body = await response.text();
    let message = "Upload failed";
    try {
      message = JSON.parse(body).error || message;
    } catch {
      message = body || message;
    }
    throw new Error(message);
  }
  return (await response.json()) as { cid: string };
}

export function usePostFormState() {
  const [state, setState] = useState<FormState>(initialState);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [uploadingField, setUploadingField] = useState<UploadField | null>(
    null,
  );
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [tagInput, setTagInput] = useState("");

  function addTag(tag: string) {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed || state.tags.includes(trimmed)) {
      return;
    }
    setState((current) => ({
      ...current,
      tags: [...current.tags, trimmed],
    }));
    setTagInput("");
  }

  function removeTag(tag: string) {
    setState((current) => ({
      ...current,
      tags: current.tags.filter((value) => value !== tag),
    }));
  }

  function selectType(nextType: FormState["type"]) {
    if (!AVAILABLE_TYPE_OPTIONS.includes(nextType)) {
      return;
    }

    const preset = TYPE_CONFIG[nextType];
    setState((current) => ({
      ...current,
      type: nextType,
      container: preset.defaultContainer,
      metric: preset.defaultMetric,
      domain: preset.defaultDomain,
      minimumScore: String(preset.defaultMinimumScore),
      evaluationCriteria: preset.scoringTemplate || current.evaluationCriteria,
      hiddenLabels: "",
      tolerance: nextType === "reproducibility" ? "0.001" : "",
      train: "",
      test: "",
      detectedColumns: [],
      ...(nextType === "reproducibility"
        ? { reproPresetId: TYPE_CONFIG.reproducibility.defaultPresetId }
        : {}),
      ...(nextType === "prediction"
        ? { idColumn: "id", labelColumn: "prediction" }
        : {}),
    }));
    setFileNames({});
  }

  function handleUploadValueChange(field: UploadField, value: string) {
    setState((current) => ({
      ...current,
      [field]: value,
      ...(!value && current.type === "reproducibility" && field === "test"
        ? { detectedColumns: [] }
        : {}),
    }));
    if (!value) {
      setFileNames((current) => ({ ...current, [field]: "" }));
    }
  }

  async function handleFileUpload(
    file: File,
    field: UploadField,
    onError: (message: string) => void,
  ) {
    setUploadingField(field);

    try {
      const shouldDetectColumns =
        field === "test" && state.type === "reproducibility";
      const [pinResult, detectedColumns] = await Promise.all([
        pinDataFile(file),
        shouldDetectColumns ? readCsvHeader(file) : Promise.resolve([]),
      ]);

      setState((current) => ({
        ...current,
        [field]: pinResult.cid,
        ...(shouldDetectColumns && detectedColumns.length > 0
          ? { detectedColumns }
          : {}),
      }));
      setFileNames((current) => ({ ...current, [field]: file.name }));
    } catch (error) {
      onError(error instanceof Error ? error.message : "unknown error");
    } finally {
      setUploadingField(null);
    }
  }

  return {
    state,
    setState,
    showAdvanced,
    setShowAdvanced,
    showPreview,
    setShowPreview,
    uploadingField,
    fileNames,
    tagInput,
    setTagInput,
    addTag,
    removeTag,
    selectType,
    handleUploadValueChange,
    handleFileUpload,
  };
}

export type PostFormStateController = ReturnType<typeof usePostFormState>;
