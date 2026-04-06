import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
import { Input } from "@/component/ui/input";

interface DesignInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (input: string) => void;
  disabled?: boolean;
}

function detectInputType(value: string): "figma" | "local" | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("figma.com")) return "figma";
  return "local";
}

export function DesignInput({ value, onChange, onSubmit, disabled }: DesignInputProps) {
  const { t } = useTranslation();
  const inputType = detectInputType(value);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="relative flex items-center gap-2 rounded-xl border border-border bg-card p-1.5 shadow-sm transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
      <div className="relative flex-1">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("home.inputPlaceholder")}
          aria-label={t("home.inputPlaceholder")}
          disabled={disabled}
          className="border-0 bg-transparent pr-20 shadow-none focus-visible:ring-0"
        />
        {inputType && (
          <div className="absolute top-1/2 right-2 -translate-y-1/2">
            <Badge variant={inputType === "figma" ? "default" : "secondary"}>
              {inputType === "figma" ? "Figma" : t("home.badgeLocal")}
            </Badge>
          </div>
        )}
      </div>
      <Button
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        size="icon"
        className="h-9 w-9 shrink-0 rounded-lg"
        aria-label={t("common.submit")}
      >
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
