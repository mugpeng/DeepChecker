import os
import glob
import argparse
import numpy as np
import torch
import clip
from PIL import Image, UnidentifiedImageError
import cv2
from typing import List, Tuple, Optional
from itertools import combinations
import tempfile
from pdf2image import convert_from_path
import shutil
import time
import json
import sys

#########################################
#           Configuration               #
#########################################
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
# CLIP_MODEL_NAME = "ViT-B/32"
CLIP_MODEL_NAME = "ViT-L/14"
DEFAULT_TOP_K = 50  # Changed to 50 for more pairs
DEFAULT_INITIAL_CLIP_TOP = 100  # Increased to get more candidates
SIFT_RATIO_THRESHOLD = 0.75
RANSAC_REPROJ_THRESHOLD = 5.0
SUPPORTED_FORMATS = ('.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.tif', '.pdf')

#########################################
#        Core Functions                 #
#########################################

class ImageComparator:
    def __init__(self, clip_model_name=CLIP_MODEL_NAME):
        self.model, self.preprocess = clip.load(clip_model_name, device=DEVICE)
        self.model.eval()
        self.sift = cv2.SIFT_create()

    def load_image(self, path: str) -> Optional[Image.Image]:
        """Load image with comprehensive error handling"""
        try:
            # For TIFF images, use cv2 first then convert to PIL
            if path.lower().endswith(('.tiff', '.tif')):
                img_cv = cv2.imread(path)
                if img_cv is None:
                    raise ValueError(f"Failed to load TIFF image: {path}")
                img_cv = cv2.cvtColor(img_cv, cv2.COLOR_BGR2RGB)
                return Image.fromarray(img_cv)
            
            # For other formats, use PIL
            img = Image.open(path).convert("RGB")
            img.load()  # Force loading the image data
            return img
        except (UnidentifiedImageError, OSError) as e:
            print(f"⚠️ Skipping corrupt/invalid image: {path} ({str(e)})")
            return None
        except Exception as e:
            print(f"❌ Unexpected error loading {path}: {str(e)}")
            return None

    def extract_clip_features(self, image_path: str) -> Optional[np.ndarray]:
        """Extract normalized CLIP features"""
        img = self.load_image(image_path)
        if img is None:
            return None
            
        try:
            img_tensor = self.preprocess(img).unsqueeze(0).to(DEVICE)
            with torch.no_grad():
                features = self.model.encode_image(img_tensor)
                return (features / features.norm(dim=-1, keepdim=True)).cpu().numpy().squeeze()
        except RuntimeError as e:
            print(f"🚨 CLIP processing failed for {image_path}: {str(e)}")
            return None

    def extract_sift_features(self, image: np.ndarray) -> Tuple[Optional[List[cv2.KeyPoint]], Optional[np.ndarray]]:
        """Extract SIFT features from OpenCV image"""
        try:
            # Ensure image is in grayscale
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image
                
            # Normalize image if needed
            if gray.dtype != np.uint8:
                gray = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
                
            kp, des = self.sift.detectAndCompute(gray, None)
            return (kp, des) if des is not None else (None, None)
        except Exception as e:
            print(f"❌ SIFT feature extraction failed: {str(e)}")
            return None, None

    @staticmethod
    def match_features(query_des: np.ndarray, candidate_des: np.ndarray) -> List[cv2.DMatch]:
        """Match features using Lowe's ratio test"""
        matcher = cv2.BFMatcher(cv2.NORM_L2)
        matches = matcher.knnMatch(query_des, candidate_des, k=2)
        return [m for m, n in matches if m.distance < SIFT_RATIO_THRESHOLD * n.distance]

    @staticmethod
    def estimate_homography(kp1: List[cv2.KeyPoint], kp2: List[cv2.KeyPoint], 
                           matches: List[cv2.DMatch]) -> Tuple[Optional[np.ndarray], int]:
        """Estimate homography with RANSAC"""
        if len(matches) < 4:
            return None, 0
            
        src_pts = np.float32([kp1[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
        dst_pts = np.float32([kp2[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
        
        H, mask = cv2.findHomography(
            src_pts, dst_pts, 
            cv2.RANSAC, 
            RANSAC_REPROJ_THRESHOLD
        )
        return H, np.sum(mask) if mask is not None else 0

def convert_pdf_to_images(pdf_path: str, temp_dir: str) -> List[str]:
    """
    Convert PDF file to a list of images
    
    Args:
        pdf_path: Path to the PDF file
        temp_dir: Directory to store temporary image files
        
    Returns:
        List of paths to the generated image files
    """
    try:
        # Convert PDF to images
        images = convert_from_path(pdf_path)
        image_paths = []
        
        # Save each page as an image
        for i, image in enumerate(images):
            image_path = os.path.join(temp_dir, f"{os.path.basename(pdf_path)}_page_{i+1}.jpg")
            image.save(image_path, "JPEG")
            image_paths.append(image_path)
            
        return image_paths
    except Exception as e:
        print(f"❌ Error converting PDF {pdf_path}: {str(e)}")
        return []

#########################################
#        Search Pipeline                #
#########################################

def find_duplicate_images(
    folder_path: str,
    comparator: ImageComparator,
    top_k: int = DEFAULT_TOP_K,
    initial_clip_top: int = DEFAULT_INITIAL_CLIP_TOP,
    progress_callback=None
) -> Tuple[List[Tuple[Tuple[str, str], int, float]], int]:
    """
    Find potential duplicate images within a folder using CLIP and SIFT
    
    Args:
        folder_path: Directory containing images to compare
        comparator: Initialized ImageComparator instance
        top_k: Number of final results to return
        initial_clip_top: Number of CLIP candidates for SIFT verification
        progress_callback: Callback function for progress updates
    
    Returns:
        Tuple of (verified_results, total_pairs)
    """
    print(f"Starting analysis in folder: {folder_path}")
    # Create temporary directory for PDF conversions
    temp_dir = tempfile.mkdtemp()
    pdf_image_paths = []
    image_cache = {}  # Initialize image_cache at the start
    
    try:
        # Collect all images and PDFs
        print("Scanning for image files...")
        all_files = glob.glob(os.path.join(folder_path, "**", "*"), recursive=True)
        print(f"Found {len(all_files)} total files")
        images = []
        
        for f in all_files:
            if f.lower().endswith(SUPPORTED_FORMATS):
                if f.lower().endswith('.pdf'):
                    # Convert PDF to images
                    pdf_images = convert_pdf_to_images(f, temp_dir)
                    pdf_image_paths.extend(pdf_images)
                    images.extend(pdf_images)
                else:
                    images.append(f)
        
        if len(images) < 2:
            raise ValueError("Need at least 2 images to compare")

        print(f"🔍 Found {len(images)} images to compare (including PDF pages)")
        
        # Extract CLIP features for all images
        print("📊 Extracting CLIP features...")
        image_features = {}
        for img_path in images:
            # Load image once and cache it
            img = comparator.load_image(img_path)
            if img is not None:
                image_cache[img_path] = {
                    'pil_image': img,
                    'cv_image': cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
                }
                # Extract CLIP features
                try:
                    img_tensor = comparator.preprocess(img).unsqueeze(0).to(DEVICE)
                    with torch.no_grad():
                        features = comparator.model.encode_image(img_tensor)
                        image_features[img_path] = (features / features.norm(dim=-1, keepdim=True)).cpu().numpy().squeeze()
                except RuntimeError as e:
                    print(f"🚨 CLIP processing failed for {img_path}: {str(e)}")
        
        if len(image_features) < 2:
            raise ValueError("Need at least 2 valid images to compare after processing")
        
        # Calculate total possible pairs and total work units
        n = len(image_features)
        total_pairs = (n * (n - 1)) // 2
        
        # Compare all possible pairs with CLIP first
        print(f"🔄 Comparing image pairs with CLIP...")
        clip_results = []
        for img1_path, img2_path in combinations(image_features.keys(), 2):
            # Calculate CLIP similarity
            similarity = float(np.dot(image_features[img1_path], image_features[img2_path]))
            clip_results.append((img1_path, img2_path, similarity))
        
        # Sort by CLIP similarity and get top candidates
        clip_results.sort(key=lambda x: x[2], reverse=True)
        clip_candidates = clip_results[:initial_clip_top]
        
        # SIFT verification for top CLIP candidates
        print(f"🔬 Verifying top {len(clip_candidates)} candidates with SIFT...")
        verified_results = []
        pairs_processed = 0
        
        for img1_path, img2_path, clip_score in clip_candidates:
            # Use cached images
            img1_data = image_cache.get(img1_path)
            img2_data = image_cache.get(img2_path)
            
            if img1_data is None or img2_data is None:
                continue
            
            # Extract SIFT features
            kp1, des1 = comparator.extract_sift_features(img1_data['cv_image'])
            kp2, des2 = comparator.extract_sift_features(img2_data['cv_image'])
            
            # Skip if no features detected
            if des1 is None or des2 is None:
                verified_results.append(((img1_path, img2_path), 0, clip_score))
            else:
                # Feature matching and homography estimation
                matches = comparator.match_features(des1, des2)
                _, inliers = comparator.estimate_homography(kp1, kp2, matches)
                verified_results.append(((img1_path, img2_path), inliers, clip_score))
            
            # Update progress for SIFT phase
            pairs_processed += 1
            if pairs_processed % 5 == 0 or pairs_processed == len(clip_candidates):
                current_progress = min(100, int((pairs_processed / len(clip_candidates)) * 100))
                print(f"SIFT Progress: {pairs_processed}/{len(clip_candidates)} pairs ({current_progress}%)")
                if progress_callback:
                    progress_callback(current_progress)
        
        # Sort results: first by inliers (Local Matches), then by CLIP score
        verified_results.sort(key=lambda x: (x[1], x[2]), reverse=True)
        return verified_results[:top_k], total_pairs
        
    except Exception as e:
        print(f"Error in find_duplicate_images: {str(e)}")
        raise
    finally:
        # Clean up temporary files
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        # Clear image cache if it exists
        if image_cache:
            image_cache.clear()

def get_display_name(path: str, folder_path: str) -> str:
    """
    Get display name for a file path with consistent format
    Args:
        path: File path
        folder_path: Base folder path for relative path calculation
    Returns:
        Formatted display name with relative path
    """
    if path.startswith(tempfile.gettempdir()):
        # Extract original PDF name from the temporary filename
        # Format is: temp_dir/original.pdf_page_N.jpg
        base_name = os.path.basename(path)
        pdf_name = base_name.rsplit('_page_', 1)[0]  # Remove _page_N.jpg suffix
        return os.path.join(os.path.relpath(folder_path), pdf_name)
    return os.path.relpath(path, start=os.path.dirname(folder_path))

def analyze_images(folder_path, progress_callback=None, model_name="ViT-B/32"):
    """
    Analyze images in the given folder for duplicates using CLIP and SIFT
    Returns a dictionary with analysis results
    """
    results = {
        'duplicate_groups': [],
        'similar_images': [],
        'total_images': 0,
        'processing_time': 0,
        'top_pairs': [],
        'progress': 0
    }
    
    start_time = time.time()
    
    try:
        # Initialize the comparator with the selected model
        comparator = ImageComparator(clip_model_name=model_name)
        
        # Get duplicate/similar image pairs using CLIP-SIFT analysis
        verified_results, total_pairs = find_duplicate_images(folder_path, comparator, progress_callback=progress_callback)
        
        # Process the results
        if verified_results:
            # Store all verified pairs in top_pairs
            results['top_pairs'] = [
                {
                    'image1': os.path.basename(img1),
                    'image2': os.path.basename(img2),
                    'inliers': int(inliers),
                    'clip_score': float(clip_score)
                }
                for (img1, img2), inliers, clip_score in verified_results
            ]
            
            # Group results by similarity threshold
            duplicate_threshold = 100  # Minimum number of inliers for duplicates
            
            # Process each pair of images (maintaining the sort order)
            for idx, ((img1, img2), inliers, clip_score) in enumerate(verified_results):
                if inliers >= duplicate_threshold:
                    # Add to duplicate groups
                    # Check if either image is already in a group
                    added_to_existing = False
                    for group in results['duplicate_groups']:
                        if os.path.basename(img1) in group['files'] or os.path.basename(img2) in group['files']:
                            if os.path.basename(img1) not in group['files']:
                                group['files'].append(os.path.basename(img1))
                            if os.path.basename(img2) not in group['files']:
                                group['files'].append(os.path.basename(img2))
                            added_to_existing = True
                            break
                    
                    if not added_to_existing:
                        results['duplicate_groups'].append({
                            'files': [os.path.basename(img1), os.path.basename(img2)]
                        })
                else:
                    # Add to similar images (maintaining sort order)
                    results['similar_images'].append({
                        'image1': os.path.basename(img1),
                        'image2': os.path.basename(img2),
                        'similarity_score': float(clip_score),
                        'inliers': int(inliers)
                    })
        
        # Count total images (including those from PDFs)
        image_files = [f for f in glob.glob(os.path.join(folder_path, "**", "*"), recursive=True)
                      if f.lower().endswith(SUPPORTED_FORMATS)]
        results['total_images'] = len(image_files)
        
        # Set final progress to 100% only after all processing is complete
        print(f"Processing complete: {total_pairs} pairs processed")
        results['progress'] = 100
        if progress_callback:
            progress_callback(100)
        
    except Exception as e:
        print(f"Error during analysis: {str(e)}")
        raise
    finally:
        results['processing_time'] = time.time() - start_time
    
    print(f"Analysis completed. Results: {results}")  # Debug log
    return results

#########################################
#           Main Execution              #
#########################################

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python clip_sift_search.py <folder_path>")
        sys.exit(1)
    
    results = analyze_images(sys.argv[1])
    # Print results for command line usage
    print(json.dumps(results, indent=2))
