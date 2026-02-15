import { cn } from "@/lib/util";

interface SpinnerProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeClasses = {
  sm: "h-4 w-4 border-2",
  md: "h-8 w-8 border-2",
  lg: "h-12 w-12 border-3",
  xl: "h-16 w-16 border-4",
};

export function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <div
      className={cn(
        "inline-block animate-spin rounded-full border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]",
        sizeClasses[size],
        className,
      )}
      role="status"
    >
      <span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">
        Loading...
      </span>
    </div>
  );
}

interface LoadingOverlayProps {
  message?: string;
  className?: string;
}

export function LoadingOverlay({ message = "読み込み中...", className }: LoadingOverlayProps) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-4 rounded-lg bg-card p-8 shadow-lg">
        <Spinner size="xl" className="text-primary" />
        <p className="text-lg font-medium text-foreground">{message}</p>
      </div>
    </div>
  );
}

interface LoadingCardProps {
  message?: string;
  className?: string;
}

export function LoadingCard({ message = "読み込み中...", className }: LoadingCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-lg border bg-card p-12",
        className,
      )}
    >
      <Spinner size="lg" className="text-primary" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
