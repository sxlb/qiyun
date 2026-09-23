"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface UploadButtonProps {
  /** 上传成功回调（参数为 /api/uploads/file/xxx 相对 URL） */
  onUploaded: (url: string) => void;
  /** 按钮文案 */
  label?: string;
  /** 接受的文件类型（默认图片） */
  accept?: string;
}

/** 通用图片上传按钮：选择文件 → POST /api/uploads → 回填 URL */
export default function UploadButton({
  onUploaded,
  label = "上传图片",
  accept = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/x-icon,.ico",
}: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok && data.url) {
        onUploaded(data.url);
        toast.success("上传成功");
      } else {
        toast.error(data.error || "上传失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="gap-1.5"
      >
        {uploading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5" />
        )}
        {uploading ? "上传中..." : label}
      </Button>
    </>
  );
}
