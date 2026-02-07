'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import { 
  Upload, 
  Download, 
  Eye, 
  EyeOff, 
  Loader2, 
  CheckCircle, 
  XCircle,
  Image as ImageIcon,
  Video,
  Sparkles,
  Shield,
  Zap
} from 'lucide-react';

interface ProcessedFile {
  original: File;
  processed: string | null;
  facesDetected: number;
  status: 'pending' | 'processing' | 'success' | 'error';
  error?: string;
}

interface RateLimit {
  used: number;
  remaining: number;
  limit: number;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function Home() {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [method, setMethod] = useState<'blur' | 'pixelate' | 'mask'>('blur');
  const [intensity, setIntensity] = useState(51);
  const [processing, setProcessing] = useState(false);
  const [rateLimit, setRateLimit] = useState<RateLimit | null>(null);
  const [mode, setMode] = useState<'single' | 'batch'>('single');

  // Fetch rate limit on mount
  useEffect(() => {
    fetchRateLimit();
  }, []);

  const fetchRateLimit = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/rate-limit`);
      setRateLimit(response.data);
    } catch (error) {
      console.error('Error fetching rate limit:', error);
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: ProcessedFile[] = acceptedFiles.map(file => ({
      original: file,
      processed: null,
      facesDetected: 0,
      status: 'pending'
    }));
    
    if (mode === 'single') {
      setFiles(newFiles.slice(0, 1));
    } else {
      setFiles(prev => [...prev, ...newFiles].slice(0, 10));
    }
  }, [mode]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
      'video/*': ['.mp4', '.mov', '.avi', '.webm']
    },
    maxFiles: mode === 'single' ? 1 : 10,
    multiple: mode === 'batch'
  });

  const processFiles = async () => {
    if (files.length === 0) return;
    
    if (rateLimit && rateLimit.remaining === 0) {
      alert('Rate limit exceeded. You have used all 5 free uses today.');
      return;
    }

    setProcessing(true);

    try {
      if (mode === 'single') {
        await processSingleFile(files[0], 0);
      } else {
        await processBatchFiles();
      }
      
      // Update rate limit
      await fetchRateLimit();
    } catch (error: any) {
      console.error('Processing error:', error);
      if (error.response?.status === 429) {
        alert('Rate limit exceeded. Please try again tomorrow.');
      }
    } finally {
      setProcessing(false);
    }
  };

  const processSingleFile = async (file: ProcessedFile, index: number) => {
    updateFileStatus(index, 'processing');

    try {
      const formData = new FormData();
      formData.append('file', file.original);
      formData.append('method', method);
      formData.append('intensity', intensity.toString());

      const isVideo = file.original.type.startsWith('video/');
      const endpoint = isVideo ? '/api/anonymize/video' : '/api/anonymize/image';

      const response = await axios.post(`${API_BASE_URL}${endpoint}`, formData, {
        responseType: 'blob',
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const processedUrl = URL.createObjectURL(response.data);
      const facesDetected = parseInt(response.headers['x-faces-detected'] || '0');

      updateFile(index, {
        processed: processedUrl,
        facesDetected,
        status: 'success'
      });
    } catch (error: any) {
      updateFile(index, {
        status: 'error',
        error: error.response?.data?.detail || 'Processing failed'
      });
    }
  };

  const processBatchFiles = async () => {
    const imageFiles = files.filter(f => f.original.type.startsWith('image/'));
    
    if (imageFiles.length === 0) {
      alert('Batch processing only supports images');
      return;
    }

    // Update all to processing
    files.forEach((_, index) => {
      if (files[index].original.type.startsWith('image/')) {
        updateFileStatus(index, 'processing');
      }
    });

    try {
      const formData = new FormData();
      imageFiles.forEach(file => {
        formData.append('files', file.original);
      });
      formData.append('method', method);
      formData.append('intensity', intensity.toString());

      const response = await axios.post(
        `${API_BASE_URL}/api/anonymize/batch`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      const results = response.data.results;
      
      results.forEach((result: any, idx: number) => {
        const fileIndex = files.findIndex(f => f.original.name === result.filename);
        if (fileIndex !== -1) {
          if (result.status === 'success') {
            updateFile(fileIndex, {
              processed: result.image_data,
              facesDetected: result.faces_detected,
              status: 'success'
            });
          } else {
            updateFile(fileIndex, {
              status: 'error',
              error: result.error
            });
          }
        }
      });
    } catch (error: any) {
      console.error('Batch processing error:', error);
      files.forEach((_, index) => {
        if (files[index].status === 'processing') {
          updateFile(index, {
            status: 'error',
            error: 'Batch processing failed'
          });
        }
      });
    }
  };

  const updateFileStatus = (index: number, status: ProcessedFile['status']) => {
    setFiles(prev => {
      const newFiles = [...prev];
      newFiles[index] = { ...newFiles[index], status };
      return newFiles;
    });
  };

  const updateFile = (index: number, updates: Partial<ProcessedFile>) => {
    setFiles(prev => {
      const newFiles = [...prev];
      newFiles[index] = { ...newFiles[index], ...updates };
      return newFiles;
    });
  };

  const downloadFile = (file: ProcessedFile) => {
    if (!file.processed) return;

    const link = document.createElement('a');
    link.href = file.processed;
    link.download = `anonymized_${file.original.name}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearFiles = () => {
    files.forEach(file => {
      if (file.processed) {
        URL.revokeObjectURL(file.processed);
      }
    });
    setFiles([]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Shield className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Face Anonymizer</h1>
                <p className="text-sm text-gray-500">Protect privacy with AI-powered face detection</p>
              </div>
            </div>
            
            {rateLimit && (
              <div className="text-right">
                <p className="text-sm font-medium text-gray-700">
                  Free Uses Today
                </p>
                <p className="text-2xl font-bold text-blue-600">
                  {rateLimit.remaining}/{rateLimit.limit}
                </p>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <Sparkles className="w-8 h-8 text-blue-600 mb-3" />
            <h3 className="font-semibold text-gray-900 mb-2">AI-Powered Detection</h3>
            <p className="text-sm text-gray-600">
              Advanced face detection using DeepFace with RetinaFace backend
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <Zap className="w-8 h-8 text-blue-600 mb-3" />
            <h3 className="font-semibold text-gray-900 mb-2">Fast Processing</h3>
            <p className="text-sm text-gray-600">
              Quick anonymization for both images and videos
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <Shield className="w-8 h-8 text-blue-600 mb-3" />
            <h3 className="font-semibold text-gray-900 mb-2">Privacy First</h3>
            <p className="text-sm text-gray-600">
              All processing happens locally, your files never leave your device
            </p>
          </div>
        </div>

        {/* Mode Selection */}
        <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
          <div className="flex items-center space-x-4 mb-6">
            <button
              onClick={() => setMode('single')}
              className={`px-6 py-3 rounded-lg font-medium transition-all ${
                mode === 'single'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <div className="flex items-center space-x-2">
                <ImageIcon className="w-5 h-5" />
                <span>Single File</span>
              </div>
            </button>
            <button
              onClick={() => setMode('batch')}
              className={`px-6 py-3 rounded-lg font-medium transition-all ${
                mode === 'batch'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Video className="w-5 h-5" />
                <span>Batch (up to 10)</span>
              </div>
            </button>
          </div>

          {/* Anonymization Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Anonymization Method
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['blur', 'pixelate', 'mask'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`px-4 py-2 rounded-lg font-medium capitalize transition-all ${
                      method === m
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Intensity: {intensity}
              </label>
              <input
                type="range"
                min="10"
                max="100"
                value={intensity}
                onChange={(e) => setIntensity(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>Light</span>
                <span>Heavy</span>
              </div>
            </div>
          </div>

          {/* File Upload Area */}
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-all ${
              isDragActive
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400 bg-gray-50'
            }`}
          >
            <input {...getInputProps()} />
            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            {isDragActive ? (
              <p className="text-lg text-blue-600 font-medium">Drop files here...</p>
            ) : (
              <>
                <p className="text-lg text-gray-700 font-medium mb-2">
                  Drop {mode === 'single' ? 'a file' : 'files'} here or click to browse
                </p>
                <p className="text-sm text-gray-500">
                  Supports: Images (PNG, JPG, GIF) & Videos (MP4, MOV, AVI)
                  {mode === 'batch' && ' - Max 10 images'}
                </p>
              </>
            )}
          </div>

          {/* Action Buttons */}
          {files.length > 0 && (
            <div className="flex space-x-4 mt-6">
              <button
                onClick={processFiles}
                disabled={processing || (rateLimit?.remaining === 0)}
                className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all flex items-center justify-center space-x-2"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    <span>Anonymize Faces</span>
                  </>
                )}
              </button>
              <button
                onClick={clearFiles}
                disabled={processing}
                className="px-6 py-3 rounded-lg font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:bg-gray-100 disabled:cursor-not-allowed transition-all"
              >
                Clear All
              </button>
            </div>
          )}
        </div>

        {/* Files Preview */}
        {files.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Files ({files.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {files.map((file, index) => (
                <div key={index} className="border rounded-lg overflow-hidden">
                  {/* Preview */}
                  <div className="aspect-video bg-gray-100 relative">
                    {file.processed ? (
                      file.original.type.startsWith('video/') ? (
                        <video
                          src={file.processed}
                          controls
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <img
                          src={file.processed}
                          alt="Processed"
                          className="w-full h-full object-contain"
                        />
                      )
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        {file.status === 'processing' ? (
                          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                        ) : file.original.type.startsWith('video/') ? (
                          <Video className="w-12 h-12 text-gray-400" />
                        ) : (
                          <ImageIcon className="w-12 h-12 text-gray-400" />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-4">
                    <p className="text-sm font-medium text-gray-900 truncate mb-2">
                      {file.original.name}
                    </p>
                    
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-500">
                        {(file.original.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                      
                      {file.status === 'success' && (
                        <span className="flex items-center text-xs text-green-600">
                          <CheckCircle className="w-4 h-4 mr-1" />
                          {file.facesDetected} face{file.facesDetected !== 1 ? 's' : ''}
                        </span>
                      )}
                      
                      {file.status === 'error' && (
                        <span className="flex items-center text-xs text-red-600">
                          <XCircle className="w-4 h-4 mr-1" />
                          Error
                        </span>
                      )}
                    </div>

                    {file.status === 'success' && (
                      <button
                        onClick={() => downloadFile(file)}
                        className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-all flex items-center justify-center space-x-2"
                      >
                        <Download className="w-4 h-4" />
                        <span>Download</span>
                      </button>
                    )}

                    {file.status === 'error' && (
                      <p className="text-xs text-red-600 mt-2">{file.error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-gray-500">
            Built with Next.js, FastAPI, and DeepFace | Open Source Privacy Tool
          </p>
        </div>
      </footer>
    </div>
  );
}