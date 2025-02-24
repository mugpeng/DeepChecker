function uploadFiles() {
    const formData = new FormData();
    const fileInput = document.getElementById('fileInput');
    const files = fileInput.files;
    
    if (files.length === 0) {
        showError('Please select files to upload');
        return;
    }
    
    for (let i = 0; i < files.length; i++) {
        formData.append('files[]', files[i]);
    }

    // Show loading state
    const analyzeButton = document.querySelector('.analyze-button');
    if (analyzeButton) {
        analyzeButton.disabled = true;
        analyzeButton.textContent = 'Analyzing...';
    }

    fetch('http://localhost:8000/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();
    })
    .then(data => {
        if (data.error) {
            showError(data.error);
        } else {
            displayAnalysisResults(data.analysis);
        }
    })
    .catch(error => {
        showError('Error: ' + error.message);
    })
    .finally(() => {
        // Reset button state
        if (analyzeButton) {
            analyzeButton.disabled = false;
            analyzeButton.textContent = 'Analyze';
        }
    });
}

function showError(message) {
    const resultsBox = document.getElementById('analysisResults');
    resultsBox.innerHTML = `<div class="error-message">${message}</div>`;
}

function displayAnalysisResults(analysis) {
    const resultsBox = document.getElementById('analysisResults');
    let html = '<h3>Analysis Results</h3>';
    
    // Display summary
    html += `<p>Total images analyzed: ${analysis.total_images}</p>`;
    html += `<p>Processing time: ${analysis.processing_time.toFixed(2)} seconds</p>`;
    
    // Display duplicate groups
    if (analysis.duplicate_groups.length > 0) {
        html += '<h4>Duplicate Images Found:</h4>';
        analysis.duplicate_groups.forEach((group, index) => {
            html += `<div class="duplicate-group">`;
            html += `<p>Group ${index + 1}:</p>`;
            html += `<ul>`;
            group.files.forEach(file => {
                html += `<li>${file}</li>`;
            });
            html += `</ul>`;
            html += `</div>`;
        });
    }
    
    // Display similar images
    if (analysis.similar_images.length > 0) {
        html += '<h4>Similar Images:</h4>';
        analysis.similar_images.forEach(pair => {
            html += `<div class="similar-pair">`;
            html += `<p>${pair.image1} ↔ ${pair.image2}</p>`;
            html += `<p>Similarity: ${(pair.similarity_score * 100).toFixed(1)}%</p>`;
            html += `</div>`;
        });
    }
    
    resultsBox.innerHTML = html;
} 