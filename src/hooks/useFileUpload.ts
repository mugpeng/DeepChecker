import { useState, useCallback } from 'react';
import { FileUploadState } from '../types/FileUpload';

interface AnalysisResult {
  duplicate_groups: Array<{
    files: string[];
  }>;
  similar_images: Array<{
    image1: string;
    image2: string;
    similarity_score: number;
    inliers: number;
  }>;
  top_pairs: Array<{
    image1: string;
    image2: string;
    inliers: number;
    clip_score: number;
  }>;
  total_images: number;
  processing_time: number;
  progress: number;
}

export const allowedTypes = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/tif',
  'image/x-tiff',
  'application/pdf'
];

const allowedExtensions = ['.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.tif', '.pdf'];

const isValidFileType = (file: File): boolean => {
  // First check MIME type
  if (allowedTypes.includes(file.type)) {
    return true;
  }
  // If MIME type check fails, check file extension
  const extension = '.' + file.name.split('.').pop()?.toLowerCase();
  return allowedExtensions.includes(extension);
};

export function useFileUpload(onAnalysisComplete?: (results: AnalysisResult) => void) {
  const [state, setState] = useState<FileUploadState>({
    file: null,
    files: [],
    progress: 0,
    status: 'idle',
    sessionId: null,
    selectedModel: 'ViT-B/32',  // Default model
  });

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter(isValidFileType);
    
    if (validFiles.length > 0) {
      // Upload files immediately
      const uploadFiles = async () => {
        const formData = new FormData();
        validFiles.forEach(file => {
          formData.append('files', file);
        });

        try {
          const response = await fetch('http://10.112.31.24:8080/api/upload', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            throw new Error('Upload failed');
          }

          const data = await response.json();
          setState(prev => ({ 
            ...prev, 
            files: validFiles, 
            status: 'idle', 
            error: undefined,
            sessionId: data.session_id 
          }));
        } catch (error) {
          setState(prev => ({ 
            ...prev, 
            error: 'Failed to upload files. Please try again.' 
          }));
        }
      };

      uploadFiles();
    } else {
      setState(prev => ({ 
        ...prev, 
        error: 'Invalid file type. Please upload images (JPEG, PNG, GIF, BMP, TIFF, TIF) or PDF files only.' 
      }));
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    
    // If no files selected (user clicked cancel), just return
    if (files.length === 0) {
      return;
    }
    
    const validFiles = files.filter(isValidFileType);
    
    if (validFiles.length > 0) {
      // Upload files immediately
      const uploadFiles = async () => {
        const formData = new FormData();
        validFiles.forEach(file => {
          formData.append('files', file);
        });

        try {
          const response = await fetch('http://10.112.31.24:8080/api/upload', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            throw new Error('Upload failed');
          }

          const data = await response.json();
          setState(prev => ({ 
            ...prev, 
            files: validFiles, 
            status: 'idle', 
            error: undefined,
            sessionId: data.session_id 
          }));
        } catch (error) {
          setState(prev => ({ 
            ...prev, 
            error: 'Failed to upload files. Please try again.' 
          }));
        }
      };

      uploadFiles();
    } else if (files.length > 0) {  // Only show error if files were actually selected
      setState(prev => ({ 
        ...prev, 
        error: 'Invalid file type. Please upload images (JPEG, PNG, GIF, BMP, TIFF, TIF) or PDF files only.' 
      }));
    }
  }, []);

  const handleModelSelect = useCallback((model: string) => {
    setState(prev => ({ ...prev, selectedModel: model }));
  }, []);

  const handleUpload = useCallback(async () => {
    if (!state.files?.length) return;

    if (state.files.length < 2) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: 'Need at least 2 images to compare'
      }));
      return;
    }

    setState(prev => ({ ...prev, status: 'uploading', progress: 0 }));

    try {
      // Start the analysis
      const response = await fetch(`http://10.112.31.24:8080/api/analyze/${state.sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_name: state.selectedModel || 'ViT-B/32'
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error('Analysis error:', data); // Add logging for debugging
        let errorMessage;
        if (Array.isArray(data)) {
          // Handle validation errors from FastAPI
          errorMessage = data.map(err => err.msg).join(', ');
        } else {
          errorMessage = data.detail || data.error || 'Analysis failed';
        }
        throw new Error(typeof errorMessage === 'object' ? JSON.stringify(errorMessage) : errorMessage);
      }

      // Start listening for progress updates
      const eventSource = new EventSource('http://10.112.31.24:8080/api/progress');

      eventSource.onmessage = (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        if (data.progress) {
          setState(prev => ({
            ...prev,
            progress: data.progress
          }));
        }
      };

      eventSource.addEventListener('progress', (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        setState(prev => ({
          ...prev,
          progress: data.progress
        }));
      });

      eventSource.addEventListener('complete', (event: MessageEvent) => {
        const results = JSON.parse(event.data);
        setState(prev => ({
          ...prev,
          status: 'success',
          progress: 100,
        }));
        if (onAnalysisComplete) {
          onAnalysisComplete(results);
        }
        eventSource.close();
      });

      eventSource.addEventListener('error', (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        setState(prev => ({
          ...prev,
          status: 'error',
          error: data.error || 'An error occurred during analysis',
        }));
        eventSource.close();
      });

      eventSource.onerror = () => {
        setState(prev => ({
          ...prev,
          status: 'error',
          error: 'Connection to server lost',
        }));
        eventSource.close();
      };

    } catch (error) {
      console.error('Error in handleUpload:', error);
      setState(prev => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'An error occurred during analysis'
      }));
    }
  }, [state.files, state.selectedModel, onAnalysisComplete]);

  const handleClear = useCallback(async () => {
    try {
      if (state.sessionId) {
        // Clean up session-specific files
        await fetch(`http://10.112.31.24:8080/api/cleanup/${state.sessionId}`, {
          method: 'POST'
        });
      }
      
      setState({
        file: null,
        files: [],
        progress: 0,
        status: 'idle',
        sessionId: null,
        selectedModel: state.selectedModel  // Preserve the selected model
      });
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }, [state.sessionId, state.selectedModel]);

  const handleFileDelete = useCallback((index: number) => {
    if (index === -1) {
      // Special case: clear all files
      handleClear();
    } else {
      setState(prev => ({
        ...prev,
        files: prev.files.filter((_, i) => i !== index)
      }));
    }
  }, [handleClear]);

  return {
    state,
    handlers: {
      handleDragOver,
      handleDrop,
      handleFileSelect,
      handleUpload,
      handleClear,
      handleFileDelete,
      handleModelSelect
    }
  };
}