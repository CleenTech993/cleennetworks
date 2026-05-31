import { Radio } from "lucide-react";

export function Brand({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
        <Radio className="h-4 w-4" />
      </div>
      <span>NetGrid<span className="text-primary">.</span></span>
    </div>
  );
}
