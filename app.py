import uuid
from fastapi import FastAPI, UploadFile, File, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
from typing import List, Dict
import tempfile
import shutil
from clip_sift_search import analyze_images
from fastapi.responses import StreamingResponse, JSONResponse
import json
import asyncio
from sse_starlette.sse import EventSourceResponse
import queue
import threading
from datetime import datetime, timedelta
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from pydantic import BaseModel
from collections import defaultdict
from threading import Lock

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:8080", "http://127.0.0.1:3000", "http://127.0.0.1:3001", "http://127.0.0.1:8080"],  # Allow local development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
UPLOAD_BASE_DIR = 'uploads'
CLEANUP_THRESHOLD_HOURS = 2  # Cleanup folders older than 2 hours

# Session-based progress queues with thread-safe access
progress_queues: Dict[str, queue.Queue] = {}
queue_lock = Lock()

# Dictionary to track user sessions (IP address -> list of session IDs)
user_sessions = {}

# Ensure base upload directory exists
os.makedirs(UPLOAD_BASE_DIR, exist_ok=True)

class LargeUploadMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/api/upload":
            # Increase the max upload size to 500MB
            request._max_body_size = 500 * 1024 * 1024  # 500MB in bytes
        return await call_next(request)

app.add_middleware(LargeUploadMiddleware)

def get_user_upload_dir(session_id: str) -> str:
    """Create and return a user-specific upload directory"""
    user_dir = os.path.join(UPLOAD_BASE_DIR, session_id)
    os.makedirs(user_dir, exist_ok=True)
    # Create a timestamp file to track the last access time
    with open(os.path.join(user_dir, '.last_access'), 'w') as f:
        f.write(datetime.now().isoformat())
    return user_dir

def cleanup_old_uploads():
    """Clean up upload directories and queues older than threshold"""
    try:
        current_time = datetime.now()
        for session_id in os.listdir(UPLOAD_BASE_DIR):
            session_dir = os.path.join(UPLOAD_BASE_DIR, session_id)
            if os.path.isdir(session_dir):
                # Check last access time from the timestamp file
                timestamp_file = os.path.join(session_dir, '.last_access')
                if os.path.exists(timestamp_file):
                    with open(timestamp_file, 'r') as f:
                        last_access = datetime.fromisoformat(f.read().strip())
                else:
                    # If no timestamp file, use directory modification time
                    last_access = datetime.fromtimestamp(os.path.getmtime(session_dir))
                
                if current_time - last_access > timedelta(hours=CLEANUP_THRESHOLD_HOURS):
                    print(f"Cleaning up old session: {session_id}")
                    shutil.rmtree(session_dir)
                    # Clean up associated progress queue
                    with queue_lock:
                        if session_id in progress_queues:
                            del progress_queues[session_id]
    except Exception as e:
        print(f"Error during old uploads cleanup: {str(e)}")

def analyze_files_with_progress(folder_path, model_name, session_id):
    """Run analysis in a separate thread and put progress updates in the session queue"""
    try:
        # Get the queue for this session
        with queue_lock:
            if session_id not in progress_queues:
                progress_queues[session_id] = queue.Queue()
            session_queue = progress_queues[session_id]

        # Run analysis with progress updates to session queue
        results = analyze_images(
            folder_path,
            progress_callback=lambda p: session_queue.put({"progress": p}),
            model_name=model_name
        )
        session_queue.put({"done": True, "results": results})
    except Exception as e:
        session_queue.put({"error": str(e)})
    finally:
        # Clean up the queue after analysis is complete
        with queue_lock:
            if session_id in progress_queues:
                del progress_queues[session_id]

def update_session_access_time(session_id: str):
    """Update the last access time for a session"""
    try:
        session_dir = os.path.join(UPLOAD_BASE_DIR, session_id)
        if os.path.isdir(session_dir):
            with open(os.path.join(session_dir, '.last_access'), 'w') as f:
                f.write(datetime.now().isoformat())
    except Exception as e:
        print(f"Error updating session access time: {str(e)}")

# Function to get user IP address from request
def get_client_ip(request: Request) -> str:
    """Get client IP address from request"""
    if "x-forwarded-for" in request.headers:
        return request.headers["x-forwarded-for"].split(",")[0]
    return request.client.host

def cleanup_user_previous_sessions(user_ip: str, current_session_id: str):
    """Clean up previous sessions for a user"""
    if user_ip in user_sessions:
        for session_id in user_sessions[user_ip]:
            if session_id != current_session_id:  # Don't delete the current session
                session_dir = os.path.join(UPLOAD_BASE_DIR, session_id)
                if os.path.exists(session_dir):
                    print(f"Cleaning up previous session {session_id} for user {user_ip}")
                    shutil.rmtree(session_dir)
        # Update user sessions to only include the current session
        user_sessions[user_ip] = [current_session_id]

@app.post("/api/upload")
async def upload_files(
    request: Request,
    files: List[UploadFile] = File(...),
    model_name: str = "ViT-B/32"  # Default model if not specified
):
    try:
        # Generate unique session ID for this upload
        session_id = str(uuid.uuid4())
        user_upload_dir = get_user_upload_dir(session_id)
        
        # Get user IP and clean up their previous sessions
        user_ip = get_client_ip(request)
        cleanup_user_previous_sessions(user_ip, session_id)
        
        # Add new session to user_sessions
        if user_ip not in user_sessions:
            user_sessions[user_ip] = []
        user_sessions[user_ip].append(session_id)
        
        # Save uploaded files preserving directory structure
        saved_files = []
        for file in files:
            # Handle potential directory structure in filename
            file_path = os.path.join(user_upload_dir, file.filename)
            
            # Ensure the directory exists
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            saved_files.append(file_path)
            
        print(f"Saved files in session {session_id} for user {user_ip}: {saved_files}")  # Debug log
        
        if saved_files:
            return {"message": "Files uploaded successfully", "session_id": session_id}
        else:
            return {"error": "No files were saved successfully"}
        
    except Exception as e:
        print(f"Error during upload: {str(e)}")  # Debug log
        return {"error": str(e)}

class AnalyzeRequest(BaseModel):
    model_name: str = "ViT-B/32"

@app.post("/api/analyze/{session_id}")
async def analyze_session(
    session_id: str,
    request: AnalyzeRequest = Body(...)  # Use Body(...) to parse request body as JSON
):
    try:
        # Validate model name
        allowed_models = ["ViT-B/32", "ViT-L/14"]
        if request.model_name not in allowed_models:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid model name. Must be one of: {', '.join(allowed_models)}"
            )

        user_upload_dir = os.path.join(UPLOAD_BASE_DIR, session_id)
        if not os.path.exists(user_upload_dir):
            raise HTTPException(
                status_code=404,
                detail="Session not found, or you may upload files in another tab."
            )

        # Count number of files in directory
        files = [f for f in os.listdir(user_upload_dir) if not f.startswith('.')]
        if len(files) < 2:
            raise HTTPException(
                status_code=400,
                detail="Need at least 2 images to compare"
            )

        # Update access time
        update_session_access_time(session_id)

        # Initialize or clear the session queue
        with queue_lock:
            if session_id in progress_queues:
                # Clear existing queue
                while not progress_queues[session_id].empty():
                    progress_queues[session_id].get()
            else:
                # Create new queue
                progress_queues[session_id] = queue.Queue()
        
        # Start analysis in a separate thread
        thread = threading.Thread(
            target=analyze_files_with_progress,
            args=(user_upload_dir, request.model_name, session_id)
        )
        thread.start()
        return {"message": "Analysis started"}
        
    except HTTPException as e:
        print(f"HTTP error in analysis: {e.detail}")  # Debug log
        raise
    except Exception as e:
        print(f"Error starting analysis: {str(e)}")  # Debug log
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/cleanup/{session_id}")
async def cleanup_session(session_id: str):
    """Clean up a specific session's uploaded files and progress queue"""
    try:
        # Clean up session directory
        session_dir = os.path.join(UPLOAD_BASE_DIR, session_id)
        if os.path.exists(session_dir):
            print(f"Manually cleaning up session: {session_id}")
            shutil.rmtree(session_dir)
            
        # Clean up progress queue
        with queue_lock:
            if session_id in progress_queues:
                del progress_queues[session_id]
                
        return {"message": "Session cleanup successful"}
    except Exception as e:
        return {"error": f"Session cleanup failed: {str(e)}"}

@app.post("/api/cleanup")
async def cleanup_files():
    """Clean up all uploaded files and progress queues"""
    try:
        # Clean up all session directories
        if os.path.exists(UPLOAD_BASE_DIR):
            print("Manual cleanup of all sessions requested")
            for item in os.listdir(UPLOAD_BASE_DIR):
                item_path = os.path.join(UPLOAD_BASE_DIR, item)
                if os.path.isdir(item_path):
                    shutil.rmtree(item_path)
                    
        # Clean up all progress queues
        with queue_lock:
            progress_queues.clear()
            
        print("All sessions cleaned up successfully")
        return {"message": "Cleanup successful"}
    except Exception as e:
        return {"error": f"Cleanup failed: {str(e)}"}

# Add background task to periodically clean up old uploads
async def periodic_cleanup():
    while True:
        try:
            cleanup_old_uploads()
            await asyncio.sleep(30 * 60)  # Run every 30 minutes
        except Exception as e:
            print(f"Error in periodic cleanup: {str(e)}")
            await asyncio.sleep(60)  # Wait a minute before retrying on error

@app.on_event("startup")
async def startup_event():
    # Start the periodic cleanup task
    asyncio.create_task(periodic_cleanup())

@app.get("/api/progress/{session_id}")
async def progress_stream(session_id: str):
    """Stream progress updates for a specific session"""
    try:
        # Ensure the session exists
        user_upload_dir = os.path.join(UPLOAD_BASE_DIR, session_id)
        if not os.path.exists(user_upload_dir):
            raise HTTPException(
                status_code=404,
                detail="Session not found"
            )

        # Get or create queue for this session
        with queue_lock:
            if session_id not in progress_queues:
                progress_queues[session_id] = queue.Queue()
            session_queue = progress_queues[session_id]

        async def event_generator():
            connection_active = True
            try:
                while connection_active:
                    try:
                        # Non-blocking queue get with timeout
                        data = session_queue.get(timeout=1.0)
                        
                        if "error" in data:
                            yield {
                                "event": "error",
                                "data": json.dumps({"error": data["error"]})
                            }
                            connection_active = False
                            
                        elif "done" in data:
                            # Send the complete event before breaking
                            yield {
                                "event": "complete",
                                "data": json.dumps(data["results"])
                            }
                            connection_active = False
                            
                        else:
                            yield {
                                "event": "progress",
                                "data": json.dumps({"progress": data["progress"]})
                            }
                    except queue.Empty:
                        # Check if session still exists
                        with queue_lock:
                            if session_id not in progress_queues:
                                connection_active = False
                                break
                        # Send keepalive every second when no updates
                        yield {
                            "event": "keepalive",
                            "data": ""
                        }
                        await asyncio.sleep(1.0)
            except Exception as e:
                print(f"Error in event generator for session {session_id}: {str(e)}")
                yield {
                    "event": "error",
                    "data": json.dumps({"error": str(e)})
                }
            finally:
                # Only clean up the queue if analysis is complete or there was an error
                if not connection_active:
                    with queue_lock:
                        if session_id in progress_queues:
                            del progress_queues[session_id]

        return EventSourceResponse(event_generator())
    except Exception as e:
        print(f"Error in progress stream for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000, limit_concurrency=None, limit_max_requests=None) 