"use client";

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  onUploadComplete: (sessionId: string, files: string[]) => void;
  sessionId: string | null;
}

interface UploadedFile {
  name: string;
  size: number;
  status: "pending" | "uploading" | "processing" | "success" | "error";
  progress?: number;
  step?: string;
  error?: string;
  documentType?: string;
}

const SUPPORTED_FORMATS = {
  documents: ["PDF", "DOC", "DOCX"],
  spreadsheets: ["XLS", "XLSX", "CSV"],
  images: ["PNG", "JPG", "JPEG", "WEBP"],
  text: ["TXT", "MD", "JSON"],
};

const MAX_FILE_SIZE = 4 * 1024 * 1024;

export default function FileUpload({
  onUploadComplete,
  sessionId,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const getAllSupportedExtensions = () => {
    return Object.values(SUPPORTED_FORMATS).flat().map((ext) => ext.toLowerCase());
  };

  const processFiles = async (fileList: FileList | File[]) => {
    const supportedExtensions = getAllSupportedExtensions();
    const newFiles = Array.from(fileList);
    const validFiles: File[] = [];
    const uploadedFiles: UploadedFile[] = [];

    for (const file of newFiles) {
      const ext = file.name.toLowerCase().split(".").pop() || "";
      
      if (!supportedExtensions.includes(ext)) {
        uploadedFiles.push({
          name: file.name,
          size: file.size,
          status: "error",
          error: "Unsupported format",
        });
        continue;
      }
      
      if (file.size > MAX_FILE_SIZE) {
        uploadedFiles.push({
          name: file.name,
          size: file.size,
          status: "error",
          error: "File too large (max 4MB)",
        });
        continue;
      }
      
      validFiles.push(file);
      uploadedFiles.push({
        name: file.name,
        size: file.size,
        status: "pending",
      });
    }

    setFiles((prev) => [...prev, ...uploadedFiles]);

    if (validFiles.length === 0) return;

    setIsUploading(true);
    setOverallProgress(0);
    setCurrentStep("Preparing upload...");

    setFiles((prev) =>
      prev.map((f) =>
        validFiles.some((vf) => vf.name === f.name)
          ? { ...f, status: "uploading" as const }
          : f
      )
    );

    const formData = new FormData();
    validFiles.forEach((file) => formData.append("files", file));
    if (sessionId) formData.append("sessionId", sessionId);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let finalSessionId = sessionId;
      const completedFiles: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          
          try {
            const data = JSON.parse(line.slice(6));

            switch (data.event) {
              case "status":
                setCurrentStep(data.message);
                if (data.progress) setOverallProgress(data.progress);
                if (data.sessionId) finalSessionId = data.sessionId;
                if (data.currentFile) {
                  setFiles((prev) =>
                    prev.map((f) =>
                      f.name === data.currentFile
                        ? { ...f, status: "processing" as const, step: data.message }
                        : f
                    )
                  );
                }
                break;

              case "step":
                if (data.file) {
                  setFiles((prev) =>
                    prev.map((f) =>
                      f.name === data.file
                        ? { ...f, step: data.message }
                        : f
                    )
                  );
                }
                break;

              case "file_complete":
                setFiles((prev) =>
                  prev.map((f) =>
                    f.name === data.filename
                      ? { 
                          ...f, 
                          status: "success" as const, 
                          documentType: data.documentType,
                          step: undefined 
                        }
                      : f
                  )
                );
                completedFiles.push(data.filename);
                break;

              case "file_error":
                setFiles((prev) =>
                  prev.map((f) =>
                    f.name === data.filename
                      ? { ...f, status: "error" as const, error: data.error }
                      : f
                  )
                );
                break;

              case "complete":
                setOverallProgress(100);
                setCurrentStep("Complete!");
                if (finalSessionId && completedFiles.length > 0) {
                  onUploadComplete(finalSessionId, completedFiles);
                }
                break;

              case "error":
                setFiles((prev) =>
                  prev.map((f) =>
                    f.status === "uploading" || f.status === "processing"
                      ? { ...f, status: "error" as const, error: data.message }
                      : f
                  )
                );
                break;
            }
          } catch {
            // Invalid JSON, skip
          }
        }
      }
    } catch (error) {
      setFiles((prev) =>
        prev.map((f) =>
          f.status === "uploading" || f.status === "processing"
            ? { ...f, status: "error" as const, error: "Connection failed" }
            : f
        )
      );
    } finally {
      setIsUploading(false);
      setTimeout(() => {
        setOverallProgress(0);
        setCurrentStep("");
      }, 2000);
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

  const getFileColor = (filename: string) => {
    const ext = filename.toLowerCase().split(".").pop() || "";
    const colors: Record<string, string> = {
      pdf: "text-red-400",
      doc: "text-blue-400",
      docx: "text-blue-400",
      xls: "text-green-400",
      xlsx: "text-green-400",
      csv: "text-green-400",
      png: "text-purple-400",
      jpg: "text-purple-400",
      jpeg: "text-purple-400",
      txt: "text-slate-400",
    };
    return colors[ext] || "text-emerald-400";
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative border-2 border-dashed rounded-2xl p-6 text-center transition-all duration-300 cursor-pointer",
          isDragging
            ? "border-emerald-500 bg-emerald-500/10"
            : "border-slate-700 hover:border-slate-600 bg-slate-900/30",
          isUploading && "pointer-events-none opacity-70"
        )}
      >
        <input
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.txt,.md,.json"
          onChange={handleFileInput}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={isUploading}
        />

        <motion.div
          animate={{ scale: isDragging ? 1.1 : 1 }}
          className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 flex items-center justify-center"
        >
          <Upload
            className={cn(
              "w-7 h-7 transition-colors",
              isDragging ? "text-emerald-400" : "text-slate-400"
            )}
          />
        </motion.div>

        <h3 className="text-lg font-semibold text-white mb-2">
          {isDragging ? "Drop files here" : "Upload Documents"}
        </h3>
        
        <p className="text-slate-400 text-sm mb-1">
          PDF, Word, Excel, Images, Text files
        </p>
        
        <p className="text-slate-500 text-xs">
          Multilingual support • Max 4MB per file
        </p>
      </div>

      {isUploading && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white">{currentStep}</span>
            <span className="text-sm text-emerald-400">{overallProgress}%</span>
          </div>
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-500"
              initial={{ width: 0 }}
              animate={{ width: `${overallProgress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </motion.div>
      )}

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
                  <FileText className={cn("w-5 h-5", getFileColor(file.name))} />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{file.name}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{formatSize(file.size)}</span>
                    {file.documentType && (
                      <span className="text-xs text-emerald-400 capitalize">• {file.documentType}</span>
                    )}
                    {file.step && (
                      <span className="text-xs text-slate-400 truncate">• {file.step}</span>
                    )}
                  </div>
                </div>

                {file.status === "pending" && (
                  <div className="w-5 h-5 rounded-full bg-slate-600" />
                )}
                {(file.status === "uploading" || file.status === "processing") && (
                  <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                )}
                {file.status === "success" && (
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                )}
                {file.status === "error" && (
                  <div className="flex items-center gap-1">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <span className="text-xs text-red-400 max-w-[100px] truncate">{file.error}</span>
                  </div>
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
