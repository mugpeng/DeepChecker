export interface FileUploadState {
  file: File | null;
  files: File[];
  progress: number;
  status: 'idle' | 'uploading' | 'success' | 'error';
  error?: string;
  result?: string;
  sessionId: string | null;
  selectedModel: string;
}