"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, CheckCircle, AlertCircle, Loader2, X, File } from "lucide-react";
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
const PAGES_PER_CHUNK = 100;
const MAX_PARALLEL_CALLS = 6;

const SUPPORTED_FORMATS = [
  { ext: "pdf", label: "PDF", color: "text-red-400" },
  { ext: "docx", label: "Word", color: "text-blue-400" },
  { ext: "xlsx", label: "Excel", color: "text-green-400" },
  { ext: "png", label: "PNG", color: "text-purple-400" },
  { ext: "jpg", label: "JPG", color: "text-orange-400" },
  { ext: "txt", label: "Text", color: "text-slate-400" },
];

function estimatePageCount(buffer: ArrayBuffer): number {
  const bytes = new Uint8Array(buffer);
  let text = "";
  const checkLength = Math.min(bytes.length, 50000);
  for (let i = 0; i < checkLength; i++) {
    text += String.fromCharCode(bytes[i]);
  }
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? Math.max(matches.length, Math.ceil(buffer.byteLength / 15000)) : Math.ceil(buffer.byteLength / 15000);
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
    if (file.size > MAX_FILE_SIZE) return "File too large (max 50MB)";
    const ext = file.name.toLowerCase().split(".").pop() || "";
    const supported = ["pdf", "png", "jpg", "jpeg", "webp", "tiff", "doc", "docx", "xls", "xlsx", "csv", "txt", "md"];
    if (!supported.includes(ext)) return "Unsupported format";
    return null;
  };

  const uploadToBlob = async (file: File): Promise<string> => {
    const ext = file.name.split(".").pop() || "";
    const baseName = file.name.replace(`.${ext}`, "");
    const uniqueName = `${baseName}_${Date.now()}.${ext}`;
    const blob = await upload(uniqueName, file, { access: "public", handleUploadUrl: "/api/blob" });
    return blob.url;
  };

  const processLargePDF = async (
    file: File, 
    blobUrl: string,
    estimatedPages: number,
    updateStatus: (msg: string, pct: number) => void
  ): Promise<{ text: string; pages: number }> => {
    const numCalls = Math.min(Math.ceil(estimatedPages / PAGES_PER_CHUNK), MAX_PARALLEL_CALLS);
    const pageRanges: Array<{ start: number; end: number }> = [];
    
    for (let i = 0; i < numCalls; i++) {
      const start = i * PAGES_PER_CHUNK + 1;
      const end = Math.min((i + 1) * PAGES_PER_CHUNK, estimatedPages);
      pageRanges.push({ start, end });
    }

    console.log(`[FileUpload] Processing ${estimatedPages} pages in ${pageRanges.length} parallel calls`);
    updateStatus(`Processing ${estimatedPages} pages in ${pageRanges.length} parallel calls...`, 20);

    const results = await Promise.allSettled(
      pageRanges.map(async (range, index) => {
        console.log(`[FileUpload] Requesting pages ${range.start}-${range.end}`);
        
        const response = await fetch("/api/process-chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blobUrl,
            filename: file.name,
            startPage: range.start,
            endPage: range.end,
            totalPages: estimatedPages,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[FileUpload] Range ${range.start}-${range.end} failed:`, errorText);
          throw new Error(`Pages ${range.start}-${range.end} failed`);
        }

        const data = await response.json();
        console.log(`[FileUpload] Pages ${range.start}-${range.end} complete, text: ${data.text?.length || 0} chars`);
        updateStatus(`Pages ${range.start}-${range.end} complete`, 20 + ((index + 1) / pageRanges.length) * 55);
        return data;
      })
    );

    let combinedText = "";
    let successCount = 0;

    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value.success) {
        const range = pageRanges[index];
        combinedText += `\n\n=== PAGES ${range.start}-${range.end} ===\n\n${result.value.text}`;
        successCount++;
      } else if (result.status === "rejected") {
        console.error(`[FileUpload] Range ${index} failed:`, result.reason);
      }
    });

    console.log(`[FileUpload] Completed: ${successCount}/${pageRanges.length} ranges, ${combinedText.length} chars`);
    updateStatus(`Extracted from ${successCount} page ranges`, 80);

    if (combinedText.length < 100) {
      throw new Error(`Only ${successCount}/${pageRanges.length} page ranges succeeded. Try with a smaller file.`);
    }

    return { text: combinedText, pages: estimatedPages };
  };

  const processSmallFile = async (file: File, blobUrl: string, updateStatus: (msg: string, pct: number) => void): Promise<string> => {
    updateStatus("Processing with AI...", 40);
    
    const response = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blobUrls: [{ url: blobUrl, filename: file.name }], sessionId }),
    });

    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response");

    const decoder = new TextDecoder();
    let newSessionId = sessionId;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      for (const line of chunk.split("\n").filter(l => l.startsWith("data:"))) {
        try {
          const data = JSON.parse(line.replace("data: ", ""));
          if (data.sessionId) newSessionId = data.sessionId;
          if (data.event === "status") updateStatus(data.message, data.progress || 50);
        } catch { continue; }
      }
    }

    return newSessionId || "";
  };

  const processFiles = useCallback(async (filesToProcess: Map<string, UploadedFile>) => {
    if (processingRef.current) return;
    
    const pending = Array.from(filesToProcess.values()).filter(f => f.status === "pending");
    if (pending.length === 0) return;

    processingRef.current = true;
    setIsProcessing(true);
    setStatusMessage("Starting...");
    setOverallProgress(5);

    try {
      for (const uploadedFile of pending) {
        const file = uploadedFile.file;
        const isPDF = file.name.toLowerCase().endsWith(".pdf");

        setFiles(prev => {
          const updated = new Map(prev);
          updated.set(file.name, { ...uploadedFile, status: "processing", progress: 10, message: "Uploading..." });
          return updated;
        });

        const updateStatus = (msg: string, pct: number) => {
          setStatusMessage(msg);
          setOverallProgress(pct);
          setFiles(prev => {
            const updated = new Map(prev);
            updated.set(file.name, { ...uploadedFile, status: "processing", progress: pct, message: msg });
            return updated;
          });
        };

        try {
          updateStatus(`Uploading ${file.name}...`, 10);
          const blobUrl = await uploadToBlob(file);
          console.log(`[FileUpload] Uploaded to blob: ${blobUrl}`);

          const buffer = await file.arrayBuffer();
          const estimatedPages = estimatePageCount(buffer);
          const isLarge = isPDF && estimatedPages > 50;

          console.log(`[FileUpload] File: ${file.name}, ${file.size} bytes, ~${estimatedPages} pages, isLarge: ${isLarge}`);

          if (isLarge) {
            updateStatus(`Large PDF (~${estimatedPages} pages) - parallel extraction...`, 15);
            
            const { text, pages } = await processLargePDF(file, blobUrl, estimatedPages, updateStatus);
            
            updateStatus("Creating search index...", 85);
            
            const indexResponse = await fetch("/api/index", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                extractedText: text,
                filename: file.name,
                pages,
                sessionId,
              }),
            });

            if (!indexResponse.ok) {
              const errorText = await indexResponse.text();
              throw new Error(`Indexing failed: ${errorText}`);
            }

            const indexData = await indexResponse.json();
            console.log(`[FileUpload] Indexed:`, indexData);
            
            onUploadComplete(indexData.sessionId, [file.name]);
            
            setFiles(prev => {
              const updated = new Map(prev);
              updated.set(file.name, { 
                ...uploadedFile, 
                status: "complete", 
                progress: 100, 
                pages,
                message: `${pages} pages, ${indexData.chunks} chunks` 
              });
              return updated;
            });
          } else {
            const newSessionId = await processSmallFile(file, blobUrl, updateStatus);
            if (newSessionId) {
              onUploadComplete(newSessionId, [file.name]);
            }
            
            setFiles(prev => {
              const updated = new Map(prev);
              updated.set(file.name, { ...uploadedFile, status: "complete", progress: 100, message: "Complete" });
              return updated;
            });
          }
        } catch (error) {
          console.error(`[FileUpload] Error:`, error);
          setFiles(prev => {
            const updated = new Map(prev);
            updated.set(file.name, { ...uploadedFile, status: "error", message: String(error) });
            return updated;
          });
        }
      }

      setStatusMessage("Complete!");
      setOverallProgress(100);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [sessionId, onUploadComplete]);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    setFiles(prev => {
      const updated = new Map(prev);
      Array.from(newFiles).forEach(file => {
        const error = validateFile(file);
        updated.set(file.name, { file, status: error ? "error" : "pending", progress: 0, message: error || undefined });
      });
      return updated;
    });
  }, []);

  useEffect(() => {
    const pending = Array.from(files.values()).filter(f => f.status === "pending");
    if (pending.length > 0 && !processingRef.current) {
      const timer = setTimeout(() => processFiles(files), 300);
      return () => clearTimeout(timer);
    }
  }, [files, processFiles]);

  const removeFile = (name: string) => setFiles(prev => { const u = new Map(prev); u.delete(name); return u; });
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }, [addFiles]);
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);

  return (
    <div className="space-y-4">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all",
          isDragging ? "border-emerald-500 bg-emerald-500/10" : "border-slate-700 hover:border-slate-600 hover:bg-slate-800/30"
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
        <p className="text-sm text-slate-400 mb-3">Up to 50MB - Parallel page extraction for large PDFs</p>
        <div className="flex flex-wrap gap-2 justify-center">
          {SUPPORTED_FORMATS.map((f) => (
            <span key={f.ext} className={cn("text-xs px-2 py-0.5 rounded bg-slate-800", f.color)}>{f.label}</span>
          ))}
        </div>
      </div>

      {files.size > 0 && (
        <div className="space-y-2">
          <AnimatePresence>
            {Array.from(files.entries()).map(([name, uf]) => (
              <motion.div key={name} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                <File className="w-5 h-5 text-slate-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white truncate">{name}</span>
                    <span className="text-xs text-slate-500">({(uf.file.size / 1024 / 1024).toFixed(1)} MB)</span>
                  </div>
                  {uf.message && <p className={cn("text-xs mt-0.5", uf.status === "error" ? "text-red-400" : "text-slate-400")}>{uf.message}</p>}
                </div>
                {uf.status === "error" && <button onClick={() => removeFile(name)} className="p-1 hover:bg-slate-700 rounded"><X className="w-4 h-4 text-slate-400" /></button>}
                {(uf.status === "uploading" || uf.status === "processing") && <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />}
                {uf.status === "complete" && <CheckCircle className="w-5 h-5 text-emerald-400" />}
                {uf.status === "error" && <AlertCircle className="w-5 h-5 text-red-400" />}
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
            <motion.div initial={{ width: 0 }} animate={{ width: `${overallProgress}%` }} className="h-full bg-gradient-to-r from-emerald-500 to-teal-500" />
          </div>
        </div>
      )}
    </div>
  );
}
