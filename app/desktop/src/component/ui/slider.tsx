import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/util";

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export function Slider({ className, label, id, ...props }: SliderProps) {
  return (
    <input
      type="range"
      id={id}
      className={cn(
        "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary",
        "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary",
        "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary",
        className,
      )}
      aria-label={label}
      {...props}
    />
  );
}
