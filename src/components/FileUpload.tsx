"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, X, File } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  onUploadComplete: (sessionId: string, files: string[]) => void;
  sessionId: string | null;
}

interface UploadedFile {
  file: File;
  status: "pending" | "uploading" | "processing" | "complete" | "error";
  progress: number;
  message?: string;
  pages?: number;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_PARALLEL_CHUNKS = 8;

const SUPPORTED_FORMATS = [
  { ext: "pdf", label: "PDF", color: "text-red-400" },
  { ext: "docx", label: "Word", color: "text-blue-400" },
  { ext: "xlsx", label: "Excel", color: "text-green-400" },
  { ext: "png", label: "PNG", color: "text-purple-400" },
  { ext: "jpg", label: "JPG", color: "text-orange-400" },
  { ext: "txt", label: "Text", color: "text-slate-400" },
];

function splitFileIntoChunks(buffer: ArrayBuffer, chunkSize: number): ArrayBuffer[] {
  const chunks: ArrayBuffer[] = [];
  const totalSize = buffer.byteLength;
  
  if (totalSize <= chunkSize) {
    return [buffer];
  }
  
  for (let i = 0; i < totalSize; i += chunkSize) {
    const end = Math.min(i + chunkSize, totalSize);
    chunks.push(buffer.slice(i, end));
  }
  
  return chunks;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function FileUpload({ onUploadComplete, sessionId }: FileUploadProps) {
  const [files, setFiles] = useState<Map<string, UploadedFile>>(new Map());
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `File too large (max 50MB)`;
    }
    const ext = file.name.toLowerCase().split(".").pop() || "";
    const supported = ["pdf", "png", "jpg", "jpeg", "webp", "tiff", "doc", "docx", "xls", "xlsx", "csv", "txt", "md"];
    if (!supported.includes(ext)) {
      return `Unsupported format`;
    }
    return null;
  };

  const uploadToBlob = async (file: File): Promise<string> => {
    const ext = file.name.split(".").pop() || "";
    const baseName = file.name.replace(`.${ext}`, "");
    const uniqueName = `${baseName}_${Date.now()}.${ext}`;
    
    const blob = await upload(uniqueName, file, {
      access: "public",
      handleUploadUrl: "/api/blob",
    });
    return blob.url;
  };

  const processLargePDFParallel = async (
    file: File,
    onProgress: (msg: string, pct: number) => void
  ): Promise<{ text: string; pages: number; language: string }> => {
    const buffer = await file.arrayBuffer();
    const chunks = splitFileIntoChunks(buffer, CHUNK_SIZE);
    const totalChunks = Math.min(chunks.length, MAX_PARALLEL_CHUNKS);
    
    onProgress(`Processing ${totalChunks} chunks in parallel...`, 20);
    
    const isPDF = file.name.toLowerCase().endsWith(".pdf");
    const mimeType = isPDF ? "application/pdf" : 
      file.name.toLowerCase().endsWith(".png") ? "image/png" : 
      file.name.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";

    const results = await Promise.allSettled(
      chunks.slice(0, MAX_PARALLEL_CHUNKS).map(async (chunk, index) => {
        const base64 = arrayBufferToBase64(chunk);
        
        const response = await fetch("/api/process-chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base64Data: base64,
            filename: file.name,
            chunkIndex: index,
            totalChunks,
            mimeType,
          }),
        });

        if (!response.ok) {
          throw new Error(`Chunk ${index + 1} failed: ${response.status}`);
        }

        const data = await response.json();
        onProgress(`Chunk ${index + 1}/${totalChunks} complete`, 20 + ((index + 1) / totalChunks) * 60);
        return data;
      })
    );

    let combinedText = "";
    let totalPages = 0;
    let language = "English";
    let successCount = 0;

    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value.success) {
        combinedText += `\n\n=== SECTION ${index + 1} ===\n\n`;
        combinedText += result.value.text;
        totalPages += result.value.pages || 0;
        if (result.value.language) language = result.value.language;
        successCount++;
      }
    });

    onProgress(`Processed ${successCount}/${totalChunks} chunks`, 85);

    return { text: combinedText, pages: totalPages || chunks.length, language };
  };

  const processFiles = useCallback(async (filesToProcess: Map<string, UploadedFile>) => {
    if (processingRef.current) return;
    
    const pendingFiles = Array.from(filesToProcess.values()).filter((f) => f.status === "pending");
    if (pendingFiles.length === 0) return;

    processingRef.current = true;
    setIsProcessing(true);
    setStatusMessage("Analyzing files...");
    setOverallProgress(5);

    try {
      for (const uploadedFile of pendingFiles) {
        const file = uploadedFile.file;
        const isPDF = file.name.toLowerCase().endsWith(".pdf");
        const isLarge = file.size > CHUNK_SIZE;

        setFiles((prev) => {
          const updated = new Map(prev);
          updated.set(file.name, { ...uploadedFile, status: "processing", progress: 10, message: "Analyzing..." });
          return updated;
        });

        try {
          let extractedText = "";
          let pages = 1;
          let language = "English";

          if (isPDF && isLarge) {
            setStatusMessage(`Large PDF detected (${(file.size / 1024 / 1024).toFixed(1)}MB) - parallel processing...`);
            
            const result = await processLargePDFParallel(file, (msg, pct) => {
              setStatusMessage(msg);
              setOverallProgress(pct);
              setFiles((prev) => {
                const updated = new Map(prev);
                updated.set(file.name, { ...uploadedFile, status: "processing", progress: pct, message: msg });
                return updated;
              });
            });
            
            extractedText = result.text;
            pages = result.pages;
            language = result.language;
          } else {
            setStatusMessage(`Uploading ${file.name}...`);
            const blobUrl = await uploadToBlob(file);
            
            setStatusMessage(`Processing with AI...`);
            setOverallProgress(40);
            
            const response = await fetch("/api/upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ 
                blobUrls: [{ url: blobUrl, filename: file.name }], 
                sessionId 
              }),
            });

            if (!response.ok) {
              throw new Error(`Processing failed: ${response.status}`);
            }

            const reader = response.body?.getReader();
            if (reader) {
              const decoder = new TextDecoder();
              let newSessionId = sessionId;

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split("\n").filter((line) => line.startsWith("data:"));

                for (const line of lines) {
                  try {
                    const data = JSON.parse(line.replace("data: ", ""));
                    if (data.event === "status") {
                      setStatusMessage(data.message);
                      setOverallProgress(data.progress || overallProgress);
                      if (data.sessionId) newSessionId = data.sessionId;
                    }
                    if (data.event === "file_complete") {
                      pages = data.pages || 1;
                    }
                    if (data.event === "complete" && newSessionId) {
                      onUploadComplete(newSessionId, [file.name]);
                      setFiles((prev) => {
                        const updated = new Map(prev);
                        updated.set(file.name, { 
                          ...uploadedFile, 
                          status: "complete", 
                          progress: 100, 
                          pages,
                          message: `${pages} page(s)` 
                        });
                        return updated;
                      });
                    }
                  } catch { continue; }
                }
              }
              continue;
            }
          }

          setStatusMessage("Creating search index...");
          setOverallProgress(90);

          const blobUrl = await uploadToBlob(file);

          const response = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              blobUrls: [{ url: blobUrl, filename: file.name }], 
              sessionId,
              preExtractedText: extractedText,
              pagesProcessed: pages
            }),
          });

          if (response.ok) {
            const reader = response.body?.getReader();
            if (reader) {
              const decoder = new TextDecoder();
              let newSessionId = sessionId;

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split("\n").filter((line) => line.startsWith("data:"));

                for (const line of lines) {
                  try {
                    const data = JSON.parse(line.replace("data: ", ""));
                    if (data.event === "status" && data.sessionId) {
                      newSessionId = data.sessionId;
                    }
                    if (data.event === "complete" && newSessionId) {
                      onUploadComplete(newSessionId, [file.name]);
                    }
                  } catch { continue; }
                }
              }
            }
          }

          setFiles((prev) => {
            const updated = new Map(prev);
            updated.set(file.name, { 
              ...uploadedFile, 
              status: "complete", 
              progress: 100, 
              pages,
              message: `${pages} page(s) extracted` 
            });
            return updated;
          });

        } catch (error) {
          setFiles((prev) => {
            const updated = new Map(prev);
            updated.set(file.name, { 
              ...uploadedFile, 
              status: "error", 
              message: String(error) 
            });
            return updated;
          });
        }
      }

      setStatusMessage("Complete!");
      setOverallProgress(100);

    } catch (error) {
      setStatusMessage(`Error: ${String(error)}`);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [sessionId, onUploadComplete, overallProgress]);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const fileArray = Array.from(newFiles);
    
    setFiles((prev) => {
      const updated = new Map(prev);
      fileArray.forEach((file) => {
        const error = validateFile(file);
        updated.set(file.name, {
          file,
          status: error ? "error" : "pending",
          progress: 0,
          message: error || undefined,
        });
      });
      return updated;
    });
  }, []);

  useEffect(() => {
    const pendingFiles = Array.from(files.values()).filter(f => f.status === "pending");
    if (pendingFiles.length > 0 && !processingRef.current) {
      const timer = setTimeout(() => {
        processFiles(files);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [files, processFiles]);

  const removeFile = (filename: string) => {
    setFiles((prev) => {
      const updated = new Map(prev);
      updated.delete(filename);
      return updated;
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  return (
    <div className="space-y-4">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all",
          isDragging
            ? "border-emerald-500 bg-emerald-500/10"
            : "border-slate-700 hover:border-slate-600 hover:bg-slate-800/30"
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff,.doc,.docx,.xls,.xlsx,.csv,.txt,.md"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
          className="hidden"
        />

        <Upload className={cn("w-10 h-10 mx-auto mb-3", isDragging ? "text-emerald-400" : "text-slate-500")} />
        <p className="text-white font-medium mb-1">Drop files here or click to browse</p>
        <p className="text-sm text-slate-400 mb-3">Up to 50MB - Parallel AI processing for large PDFs</p>
        
        <div className="flex flex-wrap gap-2 justify-center">
          {SUPPORTED_FORMATS.map((format) => (
            <span key={format.ext} className={cn("text-xs px-2 py-0.5 rounded bg-slate-800", format.color)}>
              {format.label}
            </span>
          ))}
        </div>
      </div>

      {files.size > 0 && (
        <div className="space-y-2">
          <AnimatePresence>
            {Array.from(files.entries()).map(([name, uploadedFile]) => (
              <motion.div
                key={name}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50"
              >
                <File className="w-5 h-5 text-slate-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white truncate">{name}</span>
                    <span className="text-xs text-slate-500">
                      ({(uploadedFile.file.size / 1024 / 1024).toFixed(1)} MB)
                    </span>
                  </div>
                  {uploadedFile.message && (
                    <p className={cn(
                      "text-xs mt-0.5",
                      uploadedFile.status === "error" ? "text-red-400" : "text-slate-400"
                    )}>
                      {uploadedFile.message}
                    </p>
                  )}
                </div>

                {uploadedFile.status === "error" && (
                  <button onClick={() => removeFile(name)} className="p-1 hover:bg-slate-700 rounded">
                    <X className="w-4 h-4 text-slate-400" />
                  </button>
                )}
                {(uploadedFile.status === "uploading" || uploadedFile.status === "processing") && (
                  <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                )}
                {uploadedFile.status === "complete" && <CheckCircle className="w-5 h-5 text-emerald-400" />}
                {uploadedFile.status === "error" && <AlertCircle className="w-5 h-5 text-red-400" />}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {isProcessing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">{statusMessage}</span>
            <span className="text-emerald-400">{Math.round(overallProgress)}%</span>
          </div>
          <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${overallProgress}%` }}
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-500"
            />
          </div>
        </div>
      )}
    </div>
  );
}
