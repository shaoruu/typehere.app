export interface ElectronFS {
  init: () => Promise<{ salt: string; hasPasswordSet: boolean }>;
  setPassword: (password: string) => Promise<boolean>;
  verifyPassword: (password: string) => Promise<boolean>;
  readNotes: (encryptionKey: string) => Promise<{
    notes: Record<string, string>;
    metadata: Record<string, unknown>;
  }>;
  writeNote: (noteId: string, content: string, encryptionKey: string) => Promise<boolean>;
  deleteNote: (noteId: string, encryptionKey: string) => Promise<boolean>;
  writeMetadata: (metadata: unknown, encryptionKey: string) => Promise<boolean>;
  startWatching: () => Promise<boolean>;
  stopWatching: () => Promise<boolean>;
  onFileChanged: (callback: (data: { eventType: string; filename: string }) => void) => void;
}

declare global {
  interface Window {
    electronFS?: ElectronFS;
  }
}
