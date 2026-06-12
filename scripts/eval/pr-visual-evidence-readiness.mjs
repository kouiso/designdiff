#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

function parseCliArgs(argv) {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        file: { type: "string" },
        text: { type: "string" },
      },
      strict: true,
    });
    return { file: values.file, text: values.text };
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
}

function collectEvidence(input) {
  const checks = [
    {
      key: "diff_fields",
      expected: "Visual Diff の expected/actual/result フィールド",
      collect: (text) => {
        const normalized = text.toLowerCase();
        const labels = ["expected", "actual", "result"];
        const found = labels.filter((label) => {
          const pattern = new RegExp(
            `(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?\\s*[:：]`,
            "m",
          );
          return pattern.test(normalized);
        });
        return found.length === labels.length ? labels : [];
      },
    },
    {
      key: "markdown_image",
      expected: "Markdown 画像 (例: ![alt](https://.../before.png))",
      regex: /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/giu,
    },
    {
      key: "image_url",
      expected: "画像 URL (png/jpg/jpeg/webp/gif)",
      regex: /(https?:\/\/[^\s)]+\.(?:png|jpe?g|webp|gif))(?:\?[^\s)]*)?/giu,
    },
    {
      key: "figma_url",
      expected: "Figma URL (figma.com の design/file/proto)",
      regex: /https?:\/\/(?:www\.)?figma\.com\/(?:design|file|proto)\/[^\s)]+/giu,
    },
    {
      key: "review_url",
      expected: "レビュー URL (pull/merge/review を含む URL)",
      regex: /https?:\/\/[^\s)]*(?:pull|merge_requests|review)[^\s)]*/giu,
    },
  ];

  const matched = [];
  for (const check of checks) {
    const values = check.collect
      ? check.collect(input)
      : [...input.matchAll(check.regex)].map((m) => m[0]);
    if (values.length > 0) {
      matched.push({ ...check, values: [...new Set(values)] });
    }
  }
  return { checks, matched };
}

function toGuidance(sourceLabel, checks, matched) {
  const foundKeys = new Set(matched.map((m) => m.key));
  const missing = checks.filter((c) => !foundKeys.has(c.key));
  const hasAnyEvidence = matched.length > 0;

  const header = hasAnyEvidence
    ? "[PASS] compare_design readiness: visual evidence が検出されました"
    : "[FAIL] compare_design readiness: visual evidence が未検出です";

  const lines = [header, `source: ${sourceLabel}`, "", "expected vs actual:"];

  lines.push("- expected: 以下のいずれか 1 種類以上");
  for (const check of checks) {
    lines.push(`  - ${check.expected}`);
  }

  if (!hasAnyEvidence) {
    lines.push("- actual: 一致 0 件");
  } else {
    lines.push(`- actual: ${matched.length} 種類を検出`);
    for (const hit of matched) {
      lines.push(`  - ${hit.key}: ${hit.values.slice(0, 2).join(", ")}`);
    }
  }

  if (!hasAnyEvidence && missing.length > 0) {
    lines.push("", "readiness guidance:");
    lines.push("- compare_design 実行前に、次の証跡のうち最低 1 つを PR 本文へ追加してください。");
    for (const miss of missing) {
      lines.push(`  - ${miss.expected}`);
    }
    lines.push("- 推奨: before/after の画像ペア + Figma URL を併記する。");
  }

  return { hasAnyEvidence, text: lines.join("\n") };
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.text && !args.file) {
    process.stderr.write(
      "usage: node scripts/eval/pr-visual-evidence-readiness.mjs --text <markdown> | --file <path>\n",
    );
    process.exit(2);
  }

  let input = args.text;
  let sourceLabel = "--text";
  if (args.file) {
    const fullPath = resolve(process.cwd(), args.file);
    sourceLabel = fullPath;
    try {
      input = readFileSync(fullPath, "utf8");
    } catch (error) {
      process.stderr.write(`failed to read evidence file: ${error.message}\n`);
      process.exit(2);
    }
  }

  const { checks, matched } = collectEvidence(input ?? "");
  const result = toGuidance(sourceLabel, checks, matched);

  if (!result.hasAnyEvidence) {
    process.stderr.write(`${result.text}\n`);
    process.exit(1);
  }

  process.stdout.write(`${result.text}\n`);
}

main();
