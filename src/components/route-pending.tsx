import { Skeleton } from "@/components/ui/skeleton";

export function RoutePending() {
  return (
    <div
      className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6"
      role="status"
      aria-live="polite"
      aria-label="Loading page"
    >
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <span className="sr-only">Please wait while this page loads.</span>
    </div>
  );
}
