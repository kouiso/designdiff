import { useRef, useState } from "react";

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

const isImageFile = (file: File): boolean => {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name);
};

export function DesignInput({ value, onChange, onSubmit, disabled }: DesignInputProps) {
  const { t } = useTranslation();
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const dragCounter = useRef(0);
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

  const hasFileItem = (dataTransfer: DataTransfer) => dataTransfer.types.includes("Files");

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!hasFileItem(e.dataTransfer)) return;
    e.preventDefault();

    dragCounter.current += 1;
    setIsDraggingImage(dragCounter.current > 0);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!hasFileItem(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = () => {
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    setIsDraggingImage(dragCounter.current > 0);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingImage(false);

    if (disabled) return;

    const file = Array.from(e.dataTransfer.files).find(isImageFile);
    if (!file) return;

    const path = window.electronAPI?.getPathForFile(file);
    if (!path) return;

    onChange(path);
    onSubmit(path);
  };

  return (
    <div
      className={`relative flex items-center gap-2 rounded-xl border bg-card p-1.5 shadow-sm transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 ${
        isDraggingImage ? "border-primary ring-2 ring-primary/25" : "border-border"
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
