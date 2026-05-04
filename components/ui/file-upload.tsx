import * as React from "react";
import { UploadCloud, File, CheckCircle2, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FileUploadProps {
  onFileSelect: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  maxSizeMB?: number;
  label?: string;
  sublabel?: string;
  className?: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onFileSelect,
  accept,
  multiple = false,
  maxSizeMB = 10,
  label = "Upload files",
  sublabel = "Drag & drop or click to browse",
  className,
}) => {
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [selectedFiles, setSelectedFiles] = React.useState<File[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);

    const validFiles: File[] = [];
    const maxBytes = maxSizeMB * 1024 * 1024;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > maxBytes) {
        setError(`File "${file.name}" exceeds the ${maxSizeMB}MB limit.`);
        return;
      }
      validFiles.push(file);
    }

    setSelectedFiles(validFiles);
    onFileSelect(validFiles);
  };

  const removeFile = (idx: number) => {
    const updated = selectedFiles.filter((_, i) => i !== idx);
    setSelectedFiles(updated);
    onFileSelect(updated);
  };

  return (
    <div className={cn("w-full space-y-3", className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed cursor-pointer transition-all",
          isDragOver
            ? "border-indigo-500 bg-indigo-500/10"
            : "border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]",
          // Presets
          "[data-design-preset=wealthos-classic]_&:border-white/15",
          "[data-design-preset=reui-nova]_&:border-white/10 [data-design-preset=reui-nova]_&:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
          "[data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-lg",
          ""
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
        <div className="p-3 rounded-full bg-indigo-500/10 text-indigo-400 mb-2">
          <UploadCloud className="h-6 w-6" />
        </div>
        <p className="text-xs font-bold text-slate-200">{label}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">{sublabel}</p>
        {accept && (
          <p className="text-[10px] font-mono text-slate-600 mt-2">
            Accepted formats: {accept} (Max {maxSizeMB}MB)
          </p>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {selectedFiles.length > 0 && (
        <div className="space-y-1.5">
          {selectedFiles.map((file, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-2 rounded-xl bg-[#0E101A] border border-white/10 text-xs"
            >
              <div className="flex items-center gap-2 truncate">
                <File className="h-4 w-4 text-indigo-400 shrink-0" />
                <span className="truncate text-slate-200">{file.name}</span>
                <span className="text-[10px] text-slate-500 font-mono">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(idx);
                }}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
FileUpload.displayName = "FileUpload";
