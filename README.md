# Overview

Face Anonymizer is a privacy-first web application that automatically detects and anonymizes faces in images and videos. Built with modern open-source technologies, it provides a clean interface for protecting identities in media files.

# Key Features:

-Auto-detect faces using DeepFace with RetinaFace

-Three anonymization styles (blur, pixelate, mask)

-Batch processing (up to 10 images)

-Video processing support

-Mobile-responsive design

-Privacy-first (no cloud storage)

-Rate limiting (5 uses/day per IP)

# Tech Stack

Backend:

FastAPI (Python 3.9+)

DeepFace + RetinaFace

OpenCV

TensorFlow

Frontend:

Next.js 14

React 18

TypeScript

Tailwind CSS

# Quick Start
Prerequisites

Python 3.9+
Node.js 18+
4GB+ RAM

Installation
1. Clone/Download the project
bashcd face-anonymizer
2. Setup Backend
bashcd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
Windows: venv\Scripts\activate

macOS/Linux: source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
3. Setup Frontend
bashcd frontend

# Install dependencies
npm install
Running the Application
Terminal 1 - Backend:
bashcd backend
source venv/bin/activate  # Windows: venv\Scripts\activate
python main.py
Backend runs on http://localhost:8000
Terminal 2 - Frontend:
bashcd frontend
npm run dev
```
Frontend runs on `http://localhost:3000`

**Access the app:** Open http://localhost:3000 in your browser

##  Project Structure
```
face-anonymizer/
├── backend/
│   ├── main.py              # FastAPI application
│   ├── requirements.txt     # Python dependencies
│   ├── Dockerfile          # Docker config
│   └── .env.example        # Environment template
│
├── frontend/
│   ├── app/
│   │   ├── page.tsx        # Main UI component
│   │   ├── layout.tsx      # Root layout
│   │   └── globals.css     # Global styles
│   ├── package.json        # Node dependencies
│   ├── tsconfig.json       # TypeScript config
│   └── next.config.js      # Next.js config
│
└── docker-compose.yml      # Docker orchestration
# Usage

Select Mode: Choose Single File or Batch (up to 10 images)
Choose Settings:

Method: Blur, Pixelate, or Mask
Intensity: 10-100 (adjustable slider)


Upload Files: Drag & drop or click to browse

Supports: PNG, JPG, GIF, MP4, MOV, AVI, WEBM


Process: Click "Anonymize Faces"
Download: Get your anonymized files

# Docker Deployment
bash# Build and run with Docker Compose
docker-compose up -d

# Access at http://localhost:3000

# Performance

Image Processing: ~1-3 seconds per image
Video Processing: ~0.1-0.2 seconds per frame
Memory Usage: 500MB-2GB (varies by file size)
Supported Formats:

Images: PNG, JPG, JPEG, GIF, WEBP
Videos: MP4, MOV, AVI, WEBM



# Privacy & Security

✅ All processing happens locally
✅ No cloud storage or external APIs
✅ Files processed in-memory only
✅ IP-based rate limiting
✅ No user tracking or analytics
✅ CORS protection enabled
