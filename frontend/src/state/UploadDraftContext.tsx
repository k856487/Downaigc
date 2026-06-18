import React from "react";

export type UploadPreviewState = {
  name: string;
  text: string;
  rawText: string;
  wordCount: number;
  error?: string;
};

export type UploadInputMode = "file" | "text";

type UploadDraft = {
  inputMode: UploadInputMode;
  pastedText: string;
  preview: UploadPreviewState | null;
};

type UploadDraftContextValue = UploadDraft & {
  setInputMode: (mode: UploadInputMode) => void;
  setPastedText: (text: string) => void;
  setPreview: React.Dispatch<React.SetStateAction<UploadPreviewState | null>>;
  clearDraft: () => void;
};

const defaultDraft: UploadDraft = {
  inputMode: "file",
  pastedText: "",
  preview: null
};

const UploadDraftContext = React.createContext<UploadDraftContextValue | null>(null);

export const UploadDraftProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [inputMode, setInputMode] = React.useState<UploadInputMode>(
    defaultDraft.inputMode
  );
  const [pastedText, setPastedText] = React.useState(defaultDraft.pastedText);
  const [preview, setPreview] = React.useState<UploadPreviewState | null>(
    defaultDraft.preview
  );

  const clearDraft = React.useCallback(() => {
    setInputMode(defaultDraft.inputMode);
    setPastedText(defaultDraft.pastedText);
    setPreview(defaultDraft.preview);
  }, []);

  const value = React.useMemo(
    () => ({
      inputMode,
      pastedText,
      preview,
      setInputMode,
      setPastedText,
      setPreview,
      clearDraft
    }),
    [inputMode, pastedText, preview, clearDraft]
  );

  return (
    <UploadDraftContext.Provider value={value}>{children}</UploadDraftContext.Provider>
  );
};

export function useUploadDraft(): UploadDraftContextValue {
  const ctx = React.useContext(UploadDraftContext);
  if (!ctx) {
    throw new Error("useUploadDraft must be used within UploadDraftProvider");
  }
  return ctx;
}
