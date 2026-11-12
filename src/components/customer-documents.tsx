import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, LoaderCircle, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatTenantDate } from "@/lib/tenant-customization";

const BUCKET = "customer-documents";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

type CustomerDocument = {
  name: string;
  path: string;
  createdAt: string | null;
  size: number | null;
  signedUrl: string;
};

function formatFileSize(size: number | null) {
  if (size == null) return "Size unavailable";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function CustomerDocuments({
  tenantId,
  customerId,
}: {
  tenantId: string;
  customerId: string;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const prefix = `${tenantId}/${customerId}`;
  const queryKey = ["customer-documents", tenantId, customerId];

  const {
    data: documents = [],
    isPending,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey,
    queryFn: async (): Promise<CustomerDocument[]> => {
      const { data: files, error: listError } = await supabase.storage
        .from(BUCKET)
        .list(prefix, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
      if (listError) throw listError;

      return Promise.all(
        (files ?? [])
          .filter((file) => Boolean(file.id && file.name))
          .map(async (file) => {
            const path = `${prefix}/${file.name}`;
            const { data, error: signedUrlError } = await supabase.storage
              .from(BUCKET)
              .createSignedUrl(path, 3600, { download: file.name.slice(37) || true });
            if (signedUrlError) throw signedUrlError;
            const size = file.metadata?.size;
            return {
              name: file.name.slice(37) || file.name,
              path,
              createdAt: file.created_at ?? null,
              size: typeof size === "number" ? size : null,
              signedUrl: data.signedUrl,
            };
          }),
      );
    },
    staleTime: 60_000,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!ALLOWED_TYPES.has(file.type)) {
        throw new Error("Choose a PDF, image, or Word document.");
      }
      if (file.size > MAX_FILE_SIZE) throw new Error("Documents must be 10 MB or smaller.");

      const safeName =
        file.name
          .normalize("NFKC")
          .replace(/[^\w.-]+/g, "_")
          .replace(/^\.+/, "")
          .slice(-120) || "document";
      const path = `${prefix}/${crypto.randomUUID()}-${safeName}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Customer document uploaded");
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (uploadError: Error) => toast.error(uploadError.message),
    onSettled: () => {
      if (inputRef.current) inputRef.current.value = "";
    },
  });

  const remove = useMutation({
    mutationFn: async (document: CustomerDocument) => {
      const { error } = await supabase.storage.from(BUCKET).remove([document.path]);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Customer document deleted");
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (removeError: Error) => toast.error(removeError.message),
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">Customer documents</h3>
          <p className="text-xs text-muted-foreground">
            Private files for contracts and service agreements. Maximum file size: 10 MB.
          </p>
        </div>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) upload.mutate(file);
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={upload.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {upload.isPending ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          {upload.isPending ? "Uploading…" : "Upload document"}
        </Button>
      </div>

      {isError ? (
        <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">
          <p className="text-destructive">Could not load customer documents: {error.message}</p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            Retry
          </Button>
        </div>
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">Loading documents…</p>
      ) : documents.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <FileText className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium">No documents yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload a contract or service agreement to keep it with this customer’s profile.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {documents.map((document) => (
            <li
              key={document.path}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium">{document.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(document.size)}
                    {document.createdAt ? ` · ${formatTenantDate(document.createdAt)}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  asChild
                  size="icon"
                  variant="ghost"
                  aria-label={`Download ${document.name}`}
                >
                  <a href={document.signedUrl} target="_blank" rel="noreferrer">
                    <Download aria-hidden="true" />
                  </a>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${document.name}`}
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Permanently delete "${document.name}"?`)) {
                      remove.mutate(document);
                    }
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
