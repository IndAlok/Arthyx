"use client";

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, Loader2, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  onUploadComplete: (sessionId: string, files: string[]) => void;
  sessionId: string | null;
}

interface UploadedFile {
  name: string;
  size: number;
  status: "uploading" | "success" | "error";
  error?: string;
}

export default function FileUpload({
  onUploadComplete,
  sessionId,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB limit for Vercel

  const processFiles = async (fileList: FileList | File[]) => {
    const validExtensions = ["pdf", "png", "jpg", "jpeg", "webp"];
    
    const newFiles = Array.from(fileList).filter((file) => {
      const ext = file.name.toLowerCase().split(".").pop();
      return validExtensions.includes(ext || "");
    });

    if (newFiles.length === 0) return;

    const oversizedFiles = newFiles.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversizedFiles.length > 0) {
      setFiles((prev) => [
        ...prev,
        ...oversizedFiles.map((f) => ({
          name: f.name,
          size: f.size,
          status: "error" as const,
          error: `File too large (max 4MB)`,
        })),
      ]);
      const validFiles = newFiles.filter((f) => f.size <= MAX_FILE_SIZE);
      if (validFiles.length === 0) return;
      newFiles.length = 0;
      newFiles.push(...validFiles);
    }

    setFiles((prev) => [
      ...prev,
      ...newFiles.map((f) => ({
        name: f.name,
        size: f.size,
        status: "uploading" as const,
      })),
    ]);

    setIsUploading(true);

    const formData = new FormData();
    newFiles.forEach((file) => formData.append("files", file));
    if (sessionId) formData.append("sessionId", sessionId);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        setFiles((prev) =>
          prev.map((f) =>
            newFiles.some((nf) => nf.name === f.name)
              ? { ...f, status: "success" as const }
              : f
          )
        );
        onUploadComplete(
          data.sessionId,
          data.files.map((f: { filename: string }) => f.filename)
        );
      } else {
        setFiles((prev) =>
          prev.map((f) =>
            newFiles.some((nf) => nf.name === f.name)
              ? { ...f, status: "error" as const, error: data.error }
              : f
          )
        );
      }
    } catch {
      setFiles((prev) =>
        prev.map((f) =>
          newFiles.some((nf) => nf.name === f.name)
            ? { ...f, status: "error" as const, error: "Network error" }
            : f
        )
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  }, [sessionId]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
    }
  };

  const removeFile = (name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-300 cursor-pointer",
          isDragging
            ? "border-emerald-500 bg-emerald-500/10"
            : "border-slate-700 hover:border-slate-600 bg-slate-900/30"
        )}
      >
        <input
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          onChange={handleFileInput}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={isUploading}
        />

        <motion.div
          animate={{ scale: isDragging ? 1.1 : 1 }}
          className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 flex items-center justify-center"
        >
          <Upload
            className={cn(
              "w-8 h-8 transition-colors",
              isDragging ? "text-emerald-400" : "text-slate-400"
            )}
          />
        </motion.div>

        <h3 className="text-lg font-semibold text-white mb-2">
          {isDragging ? "Drop files here" : "Upload Documents"}
        </h3>
        <p className="text-slate-400 text-sm">
          PDF, PNG, JPG • Multiple files supported • Scanned documents OK
        </p>
        <p className="text-slate-500 text-xs mt-2">
          Hindi, English, Tamil, Bengali, Gujarati + more languages
        </p>
      </div>

      <AnimatePresence>
        {files.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2"
          >
            {files.map((file) => (
              <motion.div
                key={file.name}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50"
              >
                <div className="w-10 h-10 rounded-lg bg-slate-700/50 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-emerald-400" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{file.name}</p>
                  <p className="text-xs text-slate-500">{formatSize(file.size)}</p>
                </div>

                {file.status === "uploading" && (
                  <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                )}
                {file.status === "success" && (
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                )}
                {file.status === "error" && (
                  <span className="text-xs text-red-400">{file.error}</span>
                )}

                <button
                  onClick={() => removeFile(file.name)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-700/50 flex items-center justify-center transition-colors"
                >
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
