import type { HTMLAttributes } from "react";

import { cn } from "@/lib/util";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-primary/10", className)} {...props} />;
}
