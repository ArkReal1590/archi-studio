/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState } from 'react';
import { Upload, AlertCircle } from 'lucide-react';

interface FileUploaderProps {
  label: string;
  onFileSelect: (files: File[]) => void;
  onUrlSelect?: (url: string) => void;
  accept?: string;
  multiple?: boolean;
}

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];

const validateFiles = (files: File[]): { valid: File[]; errors: string[] } => {
  const valid: File[] = [];
  const errors: string[] = [];
  files.forEach(file => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      errors.push(`"${file.name}" : format non supporté (JPEG, PNG, WebP, GIF uniquement)`);
    } else if (file.size > MAX_FILE_SIZE) {
      errors.push(`"${file.name}" : trop volumineux (max ${MAX_FILE_SIZE_MB} MB)`);
    } else {
      valid.push(file);
    }
  });
  return { valid, errors };
};

export const FileUploader: React.FC<FileUploaderProps> = ({
  label,
  onFileSelect,
  onUrlSelect,
  accept = "image/*",
  multiple = false
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const handleFiles = (files: File[]) => {
    const { valid, errors } = validateFiles(files);
    setValidationErrors(errors);
    if (valid.length > 0) {
      onFileSelect(valid);
    }
    // Auto-clear errors after 5 seconds
    if (errors.length > 0) {
      setTimeout(() => setValidationErrors([]), 5000);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // CRITICAL: Stop bubbling to parent container to avoid duplicate add
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(Array.from(e.dataTransfer.files));
      return;
    }

    if (onUrlSelect) {
      const imageUrl = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
      if (imageUrl && (imageUrl.startsWith('data:image') || imageUrl.startsWith('http'))) {
        onUrlSelect(imageUrl);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`relative w-full aspect-square rounded-2xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center cursor-pointer group
          ${isDragging
            ? 'border-blue-500 bg-blue-50/50'
            : 'border-zinc-200 bg-zinc-50 hover:bg-white hover:border-zinc-400 hover:shadow-sm'
          }`}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
      >
        <input
          type="file"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          accept={accept}
          onChange={handleChange}
          multiple={multiple}
        />
        <div className="p-4 text-center pointer-events-none">
          <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-colors
            ${isDragging ? 'bg-blue-500 text-white shadow-lg' : 'bg-white text-zinc-400 group-hover:text-zinc-900 border border-zinc-100 shadow-sm'}`}>
            <Upload size={20} strokeWidth={1.5} />
          </div>
          <p className="text-sm font-semibold text-zinc-900 mb-1">{label}</p>
          <p className="text-xs text-zinc-400">{multiple ? "Glisser plusieurs images" : "Glisser-déposer"}</p>
          <p className="text-[10px] text-zinc-400 mt-1">JPEG · PNG · WebP · max {MAX_FILE_SIZE_MB} MB</p>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <div className="rounded-xl bg-red-50 border border-red-100 p-3 flex items-start gap-2 animate-fade-in">
          <AlertCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div className="flex flex-col gap-1">
            {validationErrors.map((err, i) => (
              <p key={i} className="text-[11px] text-red-600">{err}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
