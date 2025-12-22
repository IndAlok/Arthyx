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

  const processWithAsync = async (
    blobUrl: string,
    filename: string,
    updateStatus: (msg: string, pct: number) => void
  ): Promise<{ sessionId: string; pages: number }> => {
    console.log(`[FileUpload] Starting async processing for ${filename}`);
    console.log(`[FileUpload] Blob URL: ${blobUrl.substring(0, 80)}...`);
    console.log(`[FileUpload] Session ID: ${sessionId || "new session will be created"}`);
    
    const response = await fetch("/api/async-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blobUrl, filename, sessionId }),
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response stream");

    const decoder = new TextDecoder();
    let newSessionId = sessionId || "";
    let pages = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter(l => l.startsWith("data:"));

      for (const line of lines) {
        try {
          const data = JSON.parse(line.replace("data: ", ""));
          
          switch (data.event) {
            case "status":
              console.log(`[FileUpload] Status: ${data.message} (${data.progress}%)`);
              updateStatus(data.message, data.progress || 0);
              if (data.sessionId) newSessionId = data.sessionId;
              break;
              
            case "file_complete":
              pages = data.pages || 0;
              console.log(`[FileUpload] File complete: ${pages} pages`);
              break;
              
            case "complete":
              console.log(`[FileUpload] Processing complete`);
              if (data.sessionId) newSessionId = data.sessionId;
              break;
              
            case "error":
              throw new Error(data.message);
          }
        } catch (e) {
          if (e instanceof Error && e.message !== "Unexpected end of JSON input") {
            throw e;
          }
        }
      }
    }

    return { sessionId: newSessionId, pages };
  };

  const processSmallFile = async (
    blobUrl: string, 
    filename: string, 
    updateStatus: (msg: string, pct: number) => void
  ): Promise<string> => {
    updateStatus("Processing...", 40);
    
    const response = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blobUrls: [{ url: blobUrl, filename }], sessionId }),
    });

    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response");

    const decoder = new TextDecoder();
    let newSessionId = sessionId || "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      for (const line of decoder.decode(value).split("\n").filter(l => l.startsWith("data:"))) {
        try {
          const data = JSON.parse(line.replace("data: ", ""));
          if (data.sessionId) newSessionId = data.sessionId;
          if (data.event === "status") updateStatus(data.message, data.progress || 50);
        } catch { continue; }
      }
    }

    return newSessionId;
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
        const isLarge = isPDF && file.size > 2 * 1024 * 1024;

        setFiles(prev => {
          const updated = new Map(prev);
          updated.set(file.name, { ...uploadedFile, status: "uploading", progress: 5, message: "Uploading..." });
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
          updateStatus(`Uploading ${file.name}...`, 5);
          const blobUrl = await uploadToBlob(file);
          console.log(`[FileUpload] Uploaded to blob: ${blobUrl}`);

          if (isLarge) {
            updateStatus("Large PDF - async background processing...", 10);
            
            const { sessionId: newSessionId, pages } = await processWithAsync(blobUrl, file.name, updateStatus);
            
            onUploadComplete(newSessionId, [file.name]);
            
            setFiles(prev => {
              const updated = new Map(prev);
              updated.set(file.name, { 
                ...uploadedFile, 
                status: "complete", 
                progress: 100, 
                pages,
                message: `${pages} pages indexed` 
              });
              return updated;
            });
          } else {
            const newSessionId = await processSmallFile(blobUrl, file.name, updateStatus);
            if (newSessionId) onUploadComplete(newSessionId, [file.name]);
            
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
        <p className="text-sm text-slate-400 mb-3">Up to 50MB - Async processing for large documents</p>
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
