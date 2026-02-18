export interface DocumentPickerAsset {
  uri: string;
  name?: string;
  mimeType?: string | null;
  size?: number | null;
  file?: {
    text?: () => Promise<string>;
  } | null;
}

export type DocumentPickerResult =
  | {
      canceled: true;
      assets: null;
    }
  | {
      canceled: false;
      assets: DocumentPickerAsset[];
    };

interface DocumentPickerModule {
  getDocumentAsync: (options?: Record<string, unknown>) => Promise<DocumentPickerResult>;
}

let cachedModule: DocumentPickerModule | null | undefined;

const MISSING_DOCUMENT_PICKER_MESSAGE =
  'File import is unavailable in this build. Install `expo-document-picker` and rebuild the app.';

export function getDocumentPickerModule(): DocumentPickerModule | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }

  try {
    // Loaded lazily so app startup does not fail on stale/native-missing builds.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    cachedModule = require('expo-document-picker') as DocumentPickerModule;
  } catch {
    cachedModule = null;
  }

  return cachedModule;
}

export function getDocumentPickerMissingMessage() {
  return MISSING_DOCUMENT_PICKER_MESSAGE;
}
