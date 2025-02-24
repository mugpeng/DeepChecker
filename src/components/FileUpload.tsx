import React, { useCallback } from 'react';
import { Upload, Loader2, X, Folder, Trash2, RefreshCw } from 'lucide-react';
import { FileUploadState } from '../types/FileUpload';

// Extend HTMLInputElement to include directory upload attributes
declare module 'react' {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

interface AnalysisResult {
  imagePair: [string, string];
  inliers: number;
  clipScore: number;
}

interface FileUploadProps {
  state: FileUploadState;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUpload: () => void;
  onFileDelete: (index: number) => void;
  onModelSelect: (model: string) => void;
}

// Base URL for API endpoints
const API_BASE_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000/api'
  : 'http://10.112.31.24:8080/api';

export function FileUpload({
  state,
  onDragOver,
  onDrop,
  onFileSelect,
  onUpload,
  onFileDelete,
  onModelSelect
}: FileUploadProps) {
  const handleCleanup = async () => {
    try {
      if (!state.sessionId) {
        console.error('No session ID available for cleanup');
        return;
      }
      const response = await fetch(`${API_BASE_URL}/cleanup/${state.sessionId}`, {
        method: 'POST'
      });
      if (!response.ok) {
        throw new Error('Cleanup failed');
      }
      // Clear the file list after successful cleanup
      onFileDelete(-1); // Special value to clear all files
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  };

  // Handle file selection with cancel case
  const handleLocalFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    
    // If no files selected (user clicked cancel), just return
    if (files.length === 0) {
      return;
    }
    
    // Continue with normal file selection handling
    onFileSelect(e);
  };

  return (
    <section className="bg-white rounded-lg shadow-md p-6">
      <div className="mb-4">
        <h2 className="text-2xl font-semibold">File Upload</h2>
      </div>
      
      <div
        onDragOver={onDragOver}
        onDrop={onDrop}
        className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors"
      >
        {/* Input for multiple files */}
        <input
          type="file"
          id="file-upload"
          className="hidden"
          onChange={handleLocalFileSelect}
          accept=".png,.jpg,.jpeg,.bmp,.tiff,.tif,.pdf"
          multiple
        />
        {/* Input for folder */}
        <input
          type="file"
          id="folder-upload"
          className="hidden"
          onChange={handleLocalFileSelect}
          accept=".png,.jpg,.jpeg,.bmp,.tiff,.tif,.pdf"
          webkitdirectory=""
          directory=""
        />
        
        <div className="flex flex-col items-center">
          <Upload className="w-12 h-12 text-gray-400 mb-4" />
          <p className="text-lg text-gray-600 mb-2">
            Drag and drop files here or use buttons below
          </p>
          <p className="text-sm text-gray-500 mb-4">
            Supported formats: PNG, JPG, JPEG, BMP, TIFF, TIF, PDF
          </p>
          
          <div className="flex gap-4">
            <label
              htmlFor="file-upload"
              className="cursor-pointer px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors flex items-center"
            >
              <Upload className="w-4 h-4 mr-2" />
              Select Files
            </label>
            <label
              htmlFor="folder-upload"
              className="cursor-pointer px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors flex items-center"
            >
              <Folder className="w-4 h-4 mr-2" />
              Select Folder
            </label>
          </div>
        </div>
      </div>

      {state.error && (
        <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg flex items-center justify-between">
          <div className="flex items-center">
            <X className="w-5 h-5 mr-2 flex-shrink-0" />
            <span className="font-medium">{state.error}</span>
          </div>
          <button
            onClick={() => onFileDelete(-1)}
            className="ml-4 text-red-500 hover:text-red-700 focus:outline-none"
            title="Clear error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {state.files && state.files.length > 0 && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{state.files.length} files selected</p>
              <p className="text-sm text-gray-500">
                Total size: {(state.files.reduce((acc, file) => acc + file.size, 0) / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {/* Model Selection */}
              <div className="flex gap-2">
                <select
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={state.selectedModel || "ViT-B/32"}
                  onChange={(e) => onModelSelect(e.target.value)}
                >
                  <option value="ViT-B/32">ViT-B/32 (Faster)</option>
                  {/* <option value="ViT-B/16">ViT-B/16 (Balanced)</option> */}
                  <option value="ViT-L/14">ViT-L/14 (Accurate)</option>
                </select>
              </div>
              {/* Analyze Button */}
              <button
                onClick={onUpload}
                disabled={state.status === 'uploading'}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {state.status === 'uploading' ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing... {state.progress}%
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Analyze
                  </>
                )}
              </button>
            </div>
          </div>
          
          {state.status === 'uploading' && (
            <div className="mt-4">
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-2 bg-blue-600 rounded-full transition-all duration-300"
                  style={{ width: `${state.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* File List */}
          <div className="mt-4 max-h-40 overflow-y-auto">
            <div className="space-y-2">
              {state.files.map((file, index) => (
                <div key={index} className="flex items-center justify-between py-1 px-2 bg-white rounded hover:bg-gray-50">
                  <span className="text-sm truncate flex-1">{file.name}</span>
                  <div className="flex items-center gap-2 ml-2">
                    <span className="text-xs text-gray-500">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                    <button
                      onClick={() => onFileDelete(index)}
                      className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                      title="Delete file"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Clean Up Section - Only shown when files are uploaded */}
      {state.files && state.files.length > 0 && (
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="flex flex-col items-center text-center">
            <button
              onClick={handleCleanup}
              className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg flex items-center"
              title="Clean up uploaded files"
            >
              <RefreshCw className="w-5 h-5 mr-1" />
              Clean Up
            </button>
            <div className="mt-2 text-sm text-gray-500">
              <p>Click to clean up your current uploaded files.</p>
              <p>When you upload files, the previous files will be deleted.</p>
              <p>Files are automatically cleaned after 2 hours of inactivity.</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}