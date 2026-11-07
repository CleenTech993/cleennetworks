import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

type CustomerMessage = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  ends_at: string | null;
  read: boolean;
};

async function requestMessages(
  token: string,
  input?: { announcementId: string },
): Promise<{ messages: CustomerMessage[] }> {
  const response = await fetch("/api/public/customer/messages", {
    method: input ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(input ? { "Content-Type": "application/json" } : {}),
    },
    body: input ? JSON.stringify(input) : undefined,
  });
  const result = (await response.json()) as { messages?: CustomerMessage[]; error?: string };
  if (!response.ok) throw new Error(result.error ?? "Could not load messages.");
  return { messages: result.messages ?? [] };
}

export const Route = createFileRoute("/portal/messages")({
  head: () => ({
    meta: [{ title: "Messages — My account" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: MessagesPage,
});

function MessagesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["customer-messages", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session?.access_token) throw new Error("Sign in to view your messages.");
      return requestMessages(data.session.access_token);
    },
  });
  const markRead = useMutation({
    mutationFn: async (announcementId: string) => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session?.access_token) throw new Error("Sign in to update your messages.");
      await requestMessages(data.session.access_token, { announcementId });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customer-messages", user?.id] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const messages = query.data?.messages ?? [];
  return (
    <div>
      <PageHeader
        title="Messages"
        description="Updates from your internet provider and the NetGrid platform."
      />
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading messages…</p>
      ) : query.error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {query.error instanceof Error ? query.error.message : "Could not load messages."}
        </p>
      ) : messages.length === 0 ? (
        <EmptyState
          title="You’re all caught up"
          description="New provider and platform updates will appear here."
        />
      ) : (
        <div className="space-y-3">
          {messages.map((message) => (
            <article
              key={message.id}
              className="rounded-xl border bg-card p-4 sm:p-5"
              aria-label={message.read ? "Read message" : "Unread message"}
            >
              <div className="flex items-start gap-3">
                <Bell className="mt-1 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold">{message.title}</h2>
                    <Badge variant={message.read ? "secondary" : "default"}>
                      {message.read ? "Read" : "New"}
                    </Badge>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {message.body}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(message.created_at))}
                    {message.ends_at
                      ? ` · Available until ${new Date(message.ends_at).toLocaleString()}`
                      : ""}
                  </p>
                  {!message.read && (
                    <Button
                      className="mt-3"
                      size="sm"
                      variant="outline"
                      disabled={markRead.isPending}
                      onClick={() => markRead.mutate(message.id)}
                    >
                      <Check className="h-4 w-4" /> Mark as read
                    </Button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
