import React from 'react';
import { Download, Trash2 } from 'lucide-react';

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
}

interface ResultsProps {
  results: AnalysisResult | null;
  onClear: () => void;
}

// Helper function to clean file names
const cleanFileName = (fileName: string) => {
  // First handle PDF page suffixes if present
  let name = fileName.replace(/_page_\d+\.jpg$/, '.pdf'); // Convert PDF page back to PDF
  // Remove duplicated extensions
  const parts = name.split('.');
  if (parts.length > 2 && parts[parts.length - 1] === parts[parts.length - 2]) {
    parts.pop(); // Remove the last extension if it's a duplicate
  }
  return parts.join('.'); // Rejoin the parts to form the cleaned file name
};

// Helper function to remove duplicates and sort pairs
const getUniqueSortedPairs = (pairs: Array<{
  image1: string;
  image2: string;
  clipScore: number;
  localMatches: number;
}>) => {
  // Create a Set to track unique pairs
  const seen = new Set<string>();
  const uniquePairs = pairs.filter(pair => {
    // Create a unique key for each pair (sorted to handle both orders)
    const key = [cleanFileName(pair.image1), cleanFileName(pair.image2)]
      .sort()
      .join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return uniquePairs;
};

// Helper function to download CSV
const downloadCSV = (results: AnalysisResult) => {
  // Get current date and time for filename
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '');
  const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const filename = `similar_pairs_analysis_${dateStr}_${timeStr}.csv`;

  // Combine top_pairs and similar_images, sort by clip_score/similarity_score
  const allPairs = [
    ...results.top_pairs.map(pair => ({
      image1: pair.image1,
      image2: pair.image2,
      clipScore: pair.clip_score,
      localMatches: pair.inliers
    })),
    ...results.similar_images.map(pair => ({
      image1: pair.image1,
      image2: pair.image2,
      clipScore: pair.similarity_score,
      localMatches: pair.inliers
    }))
  ].sort((a, b) => {
    // Sort by local matches first, then by CLIP score
    if (a.localMatches !== b.localMatches) {
      return b.localMatches - a.localMatches;
    }
    return b.clipScore - a.clipScore;
  });

  // Remove duplicates and take top 50 pairs
  const uniquePairs = getUniqueSortedPairs(allPairs);
  const top50Pairs = uniquePairs.slice(0, 50);

  // Create CSV content with cleaned file names
  const csvContent = [
    'Pair Number,Image 1,Image 2,CLIP Score,Local Matches',
    ...top50Pairs.map((pair, index) => 
      `${index + 1},${cleanFileName(pair.image1)},${cleanFileName(pair.image2)},${(pair.clipScore * 100).toFixed(1)}%,${pair.localMatches}`
    )
  ].join('\n');

  // Create and trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export function Results({ results, onClear }: ResultsProps) {
  return (
    <section className="bg-white rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-semibold">Analysis Results</h2>
        <div className="space-x-2">
          <button 
            className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg"
            onClick={() => results && downloadCSV(results)}
            disabled={!results}
            title="Download top 50 similar pairs as CSV"
          >
            <Download className="w-5 h-5" />
          </button>
          <button
            onClick={onClear}
            className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg"
            title="Clear results"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
        {!results ? (
          <p className="text-gray-500 text-center">Upload images to start analysis.</p>
        ) : (
          <div className="space-y-6">
            {/* Summary */}
            <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
              <h3 className="font-medium mb-2">Analysis Summary</h3>
              <div className="text-sm text-gray-600">
                <p>Total Images Analyzed: {results.total_images}</p>
                <p>Processing Time: {results.processing_time.toFixed(2)} seconds</p>
              </div>
            </div>

            {/* Top Pairs */}
            {results.top_pairs.length > 0 && (
              <div className="space-y-4">
                <h3 className="font-medium text-lg">Top Similar Pairs</h3>
                {results.top_pairs.slice(0, 10).map((pair, index) => (
                  <div key={`top-${index}`} className="bg-white p-4 rounded-lg shadow border border-gray-200">
                    <div className="flex justify-between items-start">
                      <div className="space-y-2">
                        <h4 className="font-medium">Pair #{index + 1}</h4>
                        <div className="text-sm text-gray-600">
                          <p>Image 1: {cleanFileName(pair.image1)}</p>
                          <p>Image 2: {cleanFileName(pair.image2)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium">
                          <p className="text-blue-600">CLIP Score: {(pair.clip_score * 100).toFixed(1)}%</p>
                          <p className="text-green-600">Local Matches: {pair.inliers}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {results.top_pairs.length > 10 && (
                  <p className="text-sm text-gray-500 text-center">
                    Download CSV to see top {results.top_pairs.length} pairs
                  </p>
                )}
              </div>
            )}

            {/* Duplicate Groups */}
            {results.duplicate_groups.length > 0 && (
              <div className="space-y-4">
                <h3 className="font-medium text-lg">Duplicate Groups</h3>
                {results.duplicate_groups.map((group, index) => (
                  <div key={`dup-${index}`} className="bg-white p-4 rounded-lg shadow border border-gray-200">
                    <div className="space-y-2">
                      <h4 className="font-medium">Group #{index + 1}</h4>
                      <ul className="list-disc list-inside text-sm text-gray-600">
                        {group.files.map((file, fileIndex) => (
                          <li key={fileIndex}>{cleanFileName(file)}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {results.duplicate_groups.length === 0 && 
             results.top_pairs.length === 0 && (
              <p className="text-gray-500 text-center">No duplicate or similar images found.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}