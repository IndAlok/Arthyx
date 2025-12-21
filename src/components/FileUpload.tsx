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
  documentType?: string;
  blobUrl?: string;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const PAGES_PER_CHUNK = 50;
const MAX_PARALLEL_CHUNKS = 6;

const SUPPORTED_FORMATS = [
  { ext: "pdf", label: "PDF", color: "text-red-400" },
  { ext: "docx", label: "Word", color: "text-blue-400" },
  { ext: "xlsx", label: "Excel", color: "text-green-400" },
  { ext: "png", label: "PNG", color: "text-purple-400" },
  { ext: "jpg", label: "JPG", color: "text-orange-400" },
  { ext: "txt", label: "Text", color: "text-slate-400" },
];

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

  const estimatePageCount = (fileSize: number): number => {
    return Math.max(1, Math.ceil(fileSize / 50000));
  };

  const processLargePDFInParallel = async (
    blobUrl: string,
    filename: string,
    estimatedPages: number,
    onProgress: (msg: string, pct: number) => void
  ): Promise<{ text: string; pagesProcessed: number }> => {
    const chunks: Array<{ start: number; end: number }> = [];
    
    for (let i = 1; i <= estimatedPages; i += PAGES_PER_CHUNK) {
      chunks.push({
        start: i,
        end: Math.min(i + PAGES_PER_CHUNK - 1, estimatedPages),
      });
    }

    const limitedChunks = chunks.slice(0, MAX_PARALLEL_CHUNKS);
    
    onProgress(`Processing ${limitedChunks.length} parallel chunks...`, 30);

    const results = await Promise.allSettled(
      limitedChunks.map(async (chunk, index) => {
        const response = await fetch("/api/process-chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blobUrl,
            filename,
            startPage: chunk.start,
            endPage: chunk.end,
            totalPages: estimatedPages,
          }),
        });

        if (!response.ok) {
          throw new Error(`Chunk ${index + 1} failed`);
        }

        const data = await response.json();
        onProgress(`Chunk ${index + 1}/${limitedChunks.length} complete`, 30 + ((index + 1) / limitedChunks.length) * 50);
        return data;
      })
    );

    let combinedText = "";
    let pagesProcessed = 0;

    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value.success) {
        combinedText += `\n\n--- CHUNK ${index + 1} (Pages ${limitedChunks[index].start}-${limitedChunks[index].end}) ---\n\n`;
        combinedText += result.value.text;
        pagesProcessed += limitedChunks[index].end - limitedChunks[index].start + 1;
      }
    });

    return { text: combinedText, pagesProcessed };
  };

  const processFiles = useCallback(async (filesToProcess: Map<string, UploadedFile>) => {
    if (processingRef.current) return;
    
    const pendingFiles = Array.from(filesToProcess.values()).filter((f) => f.status === "pending");
    if (pendingFiles.length === 0) return;

    processingRef.current = true;
    setIsProcessing(true);
    setStatusMessage("Uploading files...");
    setOverallProgress(5);

    try {
      const blobUrls: Array<{ url: string; filename: string; size: number; isPDF: boolean }> = [];

      for (let i = 0; i < pendingFiles.length; i++) {
        const uploadedFile = pendingFiles[i];
        setStatusMessage(`Uploading ${uploadedFile.file.name}...`);
        
        setFiles((prev) => {
          const updated = new Map(prev);
          updated.set(uploadedFile.file.name, { ...uploadedFile, status: "uploading", progress: 20 });
          return updated;
        });

        try {
          const blobUrl = await uploadToBlob(uploadedFile.file);
          const isPDF = uploadedFile.file.name.toLowerCase().endsWith(".pdf");
          blobUrls.push({ 
            url: blobUrl, 
            filename: uploadedFile.file.name, 
            size: uploadedFile.file.size,
            isPDF 
          });
          
          setFiles((prev) => {
            const updated = new Map(prev);
            updated.set(uploadedFile.file.name, { 
              ...uploadedFile, 
              status: "processing", 
              progress: 40,
              blobUrl,
              message: "Analyzing with AI..." 
            });
            return updated;
          });
        } catch (error) {
          setFiles((prev) => {
            const updated = new Map(prev);
            updated.set(uploadedFile.file.name, { 
              ...uploadedFile, 
              status: "error", 
              message: String(error) 
            });
            return updated;
          });
        }

        setOverallProgress(10 + ((i + 1) / pendingFiles.length) * 15);
      }

      if (blobUrls.length === 0) {
        processingRef.current = false;
        setIsProcessing(false);
        return;
      }

      const largePDFs = blobUrls.filter(f => f.isPDF && f.size > 2 * 1024 * 1024);
      const smallFiles = blobUrls.filter(f => !f.isPDF || f.size <= 2 * 1024 * 1024);

      for (const pdf of largePDFs) {
        const estimatedPages = estimatePageCount(pdf.size);
        setStatusMessage(`Large PDF detected (${estimatedPages} est. pages) - parallel processing...`);
        
        setFiles((prev) => {
          const updated = new Map(prev);
          const existing = updated.get(pdf.filename);
          if (existing) {
            updated.set(pdf.filename, { 
              ...existing, 
              message: `Processing ${estimatedPages} pages in parallel...` 
            });
          }
          return updated;
        });

        try {
          const result = await processLargePDFInParallel(
            pdf.url,
            pdf.filename,
            estimatedPages,
            (msg, pct) => {
              setStatusMessage(msg);
              setOverallProgress(pct);
            }
          );

          const response = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              blobUrls: [{ url: pdf.url, filename: pdf.filename }], 
              sessionId,
              preExtractedText: result.text,
              pagesProcessed: result.pagesProcessed
            }),
          });

          if (response.ok) {
            const reader = response.body?.getReader();
            if (reader) {
              await processStream(reader, pdf.filename);
            }
          }
        } catch (error) {
          setFiles((prev) => {
            const updated = new Map(prev);
            updated.set(pdf.filename, { 
              ...updated.get(pdf.filename)!, 
              status: "error", 
              message: String(error) 
            });
            return updated;
          });
        }
      }

      if (smallFiles.length > 0) {
        setStatusMessage("Processing documents...");
        setOverallProgress(40);

        const response = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blobUrls: smallFiles, sessionId }),
        });

        if (response.ok) {
          const reader = response.body?.getReader();
          if (reader) {
            await processStream(reader);
          }
        }
      }

    } catch (error) {
      setStatusMessage(`Error: ${String(error)}`);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [sessionId, onUploadComplete]);

  const processStream = async (reader: ReadableStreamDefaultReader<Uint8Array>, specificFile?: string) => {
    const decoder = new TextDecoder();
    let newSessionId = sessionId;
    const completedFiles: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter((line) => line.startsWith("data:"));

      for (const line of lines) {
        try {
          const data = JSON.parse(line.replace("data: ", ""));

          switch (data.event) {
            case "status":
              setStatusMessage(data.message);
              setOverallProgress(data.progress || overallProgress);
              if (data.sessionId) newSessionId = data.sessionId;
              break;

            case "file_complete":
              const filename = specificFile || data.filename;
              completedFiles.push(filename);
              setFiles((prev) => {
                const updated = new Map(prev);
                const existing = updated.get(filename);
                if (existing) {
                  updated.set(filename, {
                    ...existing,
                    status: "complete",
                    progress: 100,
                    pages: data.pages,
                    message: `${data.pages} page(s) analyzed`,
                  });
                }
                return updated;
              });
              break;

            case "file_error":
              setFiles((prev) => {
                const updated = new Map(prev);
                const existing = updated.get(data.filename);
                if (existing) {
                  updated.set(data.filename, {
                    ...existing,
                    status: "error",
                    message: data.error,
                  });
                }
                return updated;
              });
              break;

            case "complete":
              setStatusMessage("Complete!");
              setOverallProgress(100);
              if (newSessionId) {
                onUploadComplete(newSessionId, completedFiles);
              }
              break;
          }
        } catch {
          continue;
        }
      }
    }
  };

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
        <p className="text-sm text-slate-400 mb-3">Up to 50MB - Large PDFs processed in parallel chunks</p>
        
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
