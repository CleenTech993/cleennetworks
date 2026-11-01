import { useState, useRef } from "react";
import {
  UploadCloud,
  Image as ImageIcon,
  X,
  RefreshCw,
  Link as LinkIcon,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

interface ImageUploaderProps {
  label: string;
  description?: string;
  value: string;
  onChange: (val: string) => void;
  maxDimension?: number;
  quality?: number;
  aspectRatio?: "square" | "landscape";
  placeholder?: string;
  tenantId?: string | null;
}

export function ImageUploader({
  label,
  description,
  value,
  onChange,
  maxDimension = 1200,
  quality = 0.85,
  aspectRatio,
  placeholder,
  tenantId,
}: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [showManualUrl, setShowManualUrl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Resize and compress on client canvas
  function compressImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(e.target?.result as string);
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
          const dataUrl = canvas.toDataURL(mime, quality);
          resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleFileSelect(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose a valid image file (PNG, JPG, or WebP).");
      return;
    }

    setUploading(true);
    try {
      const compressedDataUrl = await compressImage(file);

      // Try uploading to Supabase Storage if bucket exists
      if (tenantId) {
        try {
          const {
            data: { user },
            error: userError,
          } = await supabase.auth.getUser();
          if (userError) throw userError;
          if (!user) throw new Error("Sign in to upload portal images.");

          const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
          const fileName = `${tenantId}/${user.id}/${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${ext}`;
          const { data: uploadData, error: uploadErr } = await supabase.storage
            .from("portal-assets")
            .upload(fileName, file, { upsert: true });

          if (!uploadErr && uploadData?.path) {
            const { data: pubData } = supabase.storage
              .from("portal-assets")
              .getPublicUrl(uploadData.path);
            if (pubData?.publicUrl) {
              onChange(pubData.publicUrl);
              toast.success("Image uploaded successfully");
              return;
            }
          }
        } catch {
          // Storage bucket not configured or blocked; fallback to compressed data URL
        }
      }

      // Self-contained Data URL fallback (works everywhere without CDN/bucket dependency)
      onChange(compressedDataUrl);
      toast.success("Image added and optimized");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to process image");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <button
          type="button"
          onClick={() => setShowManualUrl(!showManualUrl)}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <LinkIcon className="h-3 w-3" />
          {showManualUrl ? "Upload File" : "Paste URL"}
        </button>
      </div>

      {description && <p className="text-xs text-muted-foreground">{description}</p>}

      {showManualUrl ? (
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder || "https://example.com/image.png"}
            className="text-xs font-mono"
          />
          {value && (
            <Button size="icon" variant="outline" onClick={() => onChange("")} title="Clear">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      ) : value ? (
        <div className="flex items-center gap-4 rounded-xl border bg-muted/30 p-3">
          <div
            className={`relative overflow-hidden rounded-lg border bg-background shrink-0 ${
              aspectRatio === "square" ? "h-16 w-16" : "h-16 w-28"
            }`}
          >
            <img src={value} alt="Preview" className="h-full w-full object-cover" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">
              {value.startsWith("data:") ? "Custom Uploaded Image" : value}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Ready and applied to captive portal
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png, image/jpeg, image/webp, image/gif"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="text-xs h-8"
            >
              {uploading ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : null}
              Replace
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-destructive"
              onClick={() => onChange("")}
              title="Remove image"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFileSelect(f);
          }}
          className="flex flex-col items-center justify-center p-5 rounded-xl border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30 cursor-pointer transition-colors text-center"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png, image/jpeg, image/webp, image/gif"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          />
          <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
            <UploadCloud className="h-5 w-5" />
          </div>
          <p className="text-xs font-semibold text-foreground">Click to upload or drag & drop</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">PNG, JPG, or WebP up to 5MB</p>
        </div>
      )}
    </div>
  );
}
