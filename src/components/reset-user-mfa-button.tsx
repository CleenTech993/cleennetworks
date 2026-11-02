import { useMutation } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resetUserMfa } from "@/lib/mfa-admin.functions";

export function ResetUserMfaButton({ userId, userLabel }: { userId: string; userLabel: string }) {
  const reset = useMutation({
    mutationFn: () => resetUserMfa({ data: { userId } }),
    onSuccess: ({ removed }) => {
      if (removed === 0) toast.info("This account has no MFA factors to reset.");
      else toast.success("MFA reset. The user must set it up again before accessing the console.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={reset.isPending}
      onClick={() => {
        if (
          window.confirm(
            `Reset MFA for ${userLabel}? This signs them out and requires them to enroll MFA again before console access.`,
          )
        ) {
          reset.mutate();
        }
      }}
    >
      <ShieldAlert className="mr-1 h-4 w-4" />
      {reset.isPending ? "Resetting…" : "Reset MFA"}
    </Button>
  );
}
