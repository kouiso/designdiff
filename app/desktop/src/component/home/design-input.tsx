import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
import { Input } from "@/component/ui/input";

interface DesignInputProps {
  onSubmit: (input: string) => void;
  disabled?: boolean;
}

function detectInputType(value: string): "figma" | "local" | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("figma.com")) return "figma";
  return "local";
}

export function DesignInput({ onSubmit, disabled }: DesignInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
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
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("home.inputPlaceholder")}
          disabled={disabled}
          className="pr-20"
        />
        {inputType && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <Badge variant={inputType === "figma" ? "default" : "secondary"}>
              {inputType === "figma" ? "Figma" : "Local"}
            </Badge>
          </div>
        )}
      </div>
      <Button onClick={handleSubmit} disabled={disabled || !value.trim()} size="icon">
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
