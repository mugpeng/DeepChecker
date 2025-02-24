import React, { useState } from 'react';
import { FileUpload } from './components/FileUpload';
import { Results } from './components/Results';
import { useFileUpload } from './hooks/useFileUpload';

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

function App() {
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult | null>(null);
  const { state, handlers } = useFileUpload((results: AnalysisResult) => {
    setAnalysisResults(results);
  });

  const handleClearResults = () => {
    setAnalysisResults(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8 flex flex-col">
      <div className="max-w-4xl mx-auto space-y-6 flex-grow">
        <header className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">DeepChecker</h1>
          <p className="text-gray-600 mt-2">Fast and accurate image duplication detection</p>
        </header>

        <FileUpload
          state={state}
          onDragOver={handlers.handleDragOver}
          onDrop={handlers.handleDrop}
          onFileSelect={handlers.handleFileSelect}
          onUpload={handlers.handleUpload}
          onFileDelete={handlers.handleFileDelete}
          onModelSelect={handlers.handleModelSelect}
        />

        <Results
          results={analysisResults}
          onClear={handleClearResults}
        />
      </div>
      
      <footer className="text-center text-gray-500 text-sm mt-8 pb-4">
        © {new Date().getFullYear()} UM_DengLab, Peng, yc47680@um.edu.mo, https://github.com/mugpeng/DeepChecker
      </footer>
    </div>
  );
}

export default App;