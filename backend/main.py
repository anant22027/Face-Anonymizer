from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from typing import List, Optional
import cv2
import numpy as np
from deepface import DeepFace
from PIL import Image
import io
import tempfile
import os
from datetime import datetime, timedelta
from collections import defaultdict
import asyncio

app = FastAPI(title="Face Anonymizer API", version="1.0.0")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting storage (in production, use Redis)
rate_limit_storage = defaultdict(list)
RATE_LIMIT = 5  # 5 requests per day per IP
RATE_LIMIT_WINDOW = timedelta(days=1)

def check_rate_limit(ip_address: str) -> bool:
    """Check if IP has exceeded rate limit"""
    now = datetime.now()
    # Clean old entries
    rate_limit_storage[ip_address] = [
        timestamp for timestamp in rate_limit_storage[ip_address]
        if now - timestamp < RATE_LIMIT_WINDOW
    ]
    
    # Check if limit exceeded
    if len(rate_limit_storage[ip_address]) >= RATE_LIMIT:
        return False
    
    # Add current request
    rate_limit_storage[ip_address].append(now)
    return True

def get_remaining_uses(ip_address: str) -> dict:
    """Get remaining uses for an IP"""
    now = datetime.now()
    rate_limit_storage[ip_address] = [
        timestamp for timestamp in rate_limit_storage[ip_address]
        if now - timestamp < RATE_LIMIT_WINDOW
    ]
    used = len(rate_limit_storage[ip_address])
    remaining = max(0, RATE_LIMIT - used)
    return {"used": used, "remaining": remaining, "limit": RATE_LIMIT}

def detect_faces_deepface(image_array):
    """Detect faces using DeepFace with RetinaFace backend"""
    try:
        # DeepFace expects BGR format (OpenCV default)
        faces = DeepFace.extract_faces(
            img_path=image_array,
            detector_backend='retinaface',
            enforce_detection=False,
            align=False
        )
        
        face_locations = []
        for face in faces:
            facial_area = face.get('facial_area', {})
            if facial_area:
                x = facial_area.get('x', 0)
                y = facial_area.get('y', 0)
                w = facial_area.get('w', 0)
                h = facial_area.get('h', 0)
                face_locations.append((x, y, w, h))
        
        return face_locations
    except Exception as e:
        print(f"DeepFace detection error: {e}")
        # Fallback to OpenCV Haar Cascade
        return detect_faces_opencv(image_array)

def detect_faces_opencv(image_array):
    """Fallback face detection using OpenCV Haar Cascade"""
    try:
        gray = cv2.cvtColor(image_array, cv2.COLOR_BGR2GRAY)
        face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        )
        faces = face_cascade.detectMultiScale(gray, 1.3, 5)
        return [(x, y, w, h) for (x, y, w, h) in faces]
    except Exception as e:
        print(f"OpenCV detection error: {e}")
        return []

def anonymize_face(image, x, y, w, h, method='blur', intensity=51):
    """Apply anonymization to a detected face region"""
    # Extract face region
    face_region = image[y:y+h, x:x+w]
    
    if method == 'blur':
        # Gaussian blur
        kernel_size = intensity if intensity % 2 == 1 else intensity + 1
        anonymized = cv2.GaussianBlur(face_region, (kernel_size, kernel_size), 0)
    
    elif method == 'pixelate':
        # Pixelation effect
        small_face = cv2.resize(face_region, (w // intensity, h // intensity), 
                                interpolation=cv2.INTER_LINEAR)
        anonymized = cv2.resize(small_face, (w, h), interpolation=cv2.INTER_NEAREST)
    
    elif method == 'mask':
        # Black rectangle mask
        anonymized = np.zeros_like(face_region)
    
    else:
        anonymized = face_region
    
    # Replace face region in original image
    image[y:y+h, x:x+w] = anonymized
    return image

def process_image(image_array, method='blur', intensity=51):
    """Process a single image to detect and anonymize faces"""
    # Detect faces
    face_locations = detect_faces_deepface(image_array)
    
    # Apply anonymization to each face
    for (x, y, w, h) in face_locations:
        image_array = anonymize_face(image_array, x, y, w, h, method, intensity)
    
    return image_array, len(face_locations)

def process_video(video_path, output_path, method='blur', intensity=51):
    """Process video to detect and anonymize faces in all frames"""
    cap = cv2.VideoCapture(video_path)
    
    # Get video properties
    fps = int(cap.get(cv2.CAP_PROP_FPS))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    # Define codec and create VideoWriter
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
    
    frame_count = 0
    total_faces = 0
    
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        
        # Process frame
        processed_frame, faces_count = process_image(frame.copy(), method, intensity)
        total_faces += faces_count
        
        # Write processed frame
        out.write(processed_frame)
        frame_count += 1
        
        # Progress tracking (could be sent via websocket in production)
        if frame_count % 10 == 0:
            progress = (frame_count / total_frames) * 100
            print(f"Processing: {progress:.1f}% - Frame {frame_count}/{total_frames}")
    
    cap.release()
    out.release()
    
    return total_faces, frame_count

@app.get("/")
async def root():
    return {
        "message": "Face Anonymizer API",
        "version": "1.0.0",
        "endpoints": {
            "health": "/health",
            "anonymize_image": "/api/anonymize/image",
            "anonymize_video": "/api/anonymize/video",
            "batch_anonymize": "/api/anonymize/batch",
            "rate_limit": "/api/rate-limit"
        }
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

@app.get("/api/rate-limit")
async def get_rate_limit(request: Request):
    """Get rate limit info for the requesting IP"""
    client_ip = request.client.host
    usage = get_remaining_uses(client_ip)
    return usage

@app.post("/api/anonymize/image")
async def anonymize_image_endpoint(
    request: Request,
    file: UploadFile = File(...),
    method: str = 'blur',
    intensity: int = 51
):
    """Anonymize faces in a single image"""
    # Check rate limit
    client_ip = request.client.host
    if not check_rate_limit(client_ip):
        usage = get_remaining_uses(client_ip)
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. You have used {usage['used']}/{usage['limit']} requests today."
        )
    
    # Validate file type
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    try:
        # Read image
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image file")
        
        # Process image
        processed_image, faces_count = process_image(image, method, intensity)
        
        # Convert back to bytes
        _, buffer = cv2.imencode('.jpg', processed_image)
        io_buf = io.BytesIO(buffer)
        
        usage = get_remaining_uses(client_ip)
        
        return StreamingResponse(
            io_buf,
            media_type="image/jpeg",
            headers={
                "X-Faces-Detected": str(faces_count),
                "X-Rate-Limit-Remaining": str(usage['remaining']),
                "X-Rate-Limit-Used": str(usage['used']),
                "Content-Disposition": f"attachment; filename=anonymized_{file.filename}"
            }
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/anonymize/video")
async def anonymize_video_endpoint(
    request: Request,
    file: UploadFile = File(...),
    method: str = 'blur',
    intensity: int = 51
):
    """Anonymize faces in a video"""
    # Check rate limit
    client_ip = request.client.host
    if not check_rate_limit(client_ip):
        usage = get_remaining_uses(client_ip)
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. You have used {usage['used']}/{usage['limit']} requests today."
        )
    
    # Validate file type
    if not file.content_type.startswith('video/'):
        raise HTTPException(status_code=400, detail="File must be a video")
    
    temp_input = None
    temp_output = None
    
    try:
        # Save uploaded video to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_input:
            contents = await file.read()
            temp_input.write(contents)
            temp_input_path = temp_input.name
        
        # Create temporary output file
        temp_output = tempfile.NamedTemporaryFile(delete=False, suffix='.mp4')
        temp_output_path = temp_output.name
        temp_output.close()
        
        # Process video
        total_faces, frames_processed = process_video(
            temp_input_path, 
            temp_output_path, 
            method, 
            intensity
        )
        
        # Read processed video
        with open(temp_output_path, 'rb') as f:
            video_bytes = f.read()
        
        io_buf = io.BytesIO(video_bytes)
        
        usage = get_remaining_uses(client_ip)
        
        return StreamingResponse(
            io_buf,
            media_type="video/mp4",
            headers={
                "X-Faces-Detected": str(total_faces),
                "X-Frames-Processed": str(frames_processed),
                "X-Rate-Limit-Remaining": str(usage['remaining']),
                "X-Rate-Limit-Used": str(usage['used']),
                "Content-Disposition": f"attachment; filename=anonymized_{file.filename}"
            }
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        # Clean up temporary files
        if temp_input_path and os.path.exists(temp_input_path):
            os.unlink(temp_input_path)
        if temp_output_path and os.path.exists(temp_output_path):
            os.unlink(temp_output_path)

@app.post("/api/anonymize/batch")
async def anonymize_batch_endpoint(
    request: Request,
    files: List[UploadFile] = File(...),
    method: str = 'blur',
    intensity: int = 51
):
    """Anonymize faces in multiple images"""
    # Check rate limit (batch counts as 1 use)
    client_ip = request.client.host
    if not check_rate_limit(client_ip):
        usage = get_remaining_uses(client_ip)
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. You have used {usage['used']}/{usage['limit']} requests today."
        )
    
    if len(files) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 files per batch")
    
    results = []
    
    for file in files:
        try:
            # Validate file type
            if not file.content_type.startswith('image/'):
                results.append({
                    "filename": file.filename,
                    "status": "error",
                    "error": "Not an image file"
                })
                continue
            
            # Read and process image
            contents = await file.read()
            nparr = np.frombuffer(contents, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                results.append({
                    "filename": file.filename,
                    "status": "error",
                    "error": "Invalid image"
                })
                continue
            
            # Process image
            processed_image, faces_count = process_image(image, method, intensity)
            
            # Convert to base64 for response
            _, buffer = cv2.imencode('.jpg', processed_image)
            import base64
            img_base64 = base64.b64encode(buffer).decode('utf-8')
            
            results.append({
                "filename": file.filename,
                "status": "success",
                "faces_detected": faces_count,
                "image_data": f"data:image/jpeg;base64,{img_base64}"
            })
        
        except Exception as e:
            results.append({
                "filename": file.filename,
                "status": "error",
                "error": str(e)
            })
    
    usage = get_remaining_uses(client_ip)
    
    return JSONResponse(content={
        "results": results,
        "rate_limit": usage
    })

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)