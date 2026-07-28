#!/usr/bin/env node
// 同じ Action が2つ以上の版に固定されていないかを見る。
//
// 版が混ざっていると、更新のたびに片方だけ書き換えられて、もう片方が
// 取り残される。どちらも動くので気づけない。壊れてから探すより、
// 混ざった時点で止めるほうが安い。

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW_DIR = ".github/workflows";
// `uses: owner/repo@sha # vX.Y.Z` の owner/repo と sha を取る。
// ローカルの複合アクション (./.github/actions/...) は対象外。
const USES_PATTERN = /uses:\s*([\w.-]+\/[\w.-]+)@([\w.-]+)/g;

function collectPins() {
  const pins = new Map();
  for (const name of readdirSync(WORKFLOW_DIR)) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    const path = join(WORKFLOW_DIR, name);
    const text = readFileSync(path, "utf8");
    for (const [, action, ref] of text.matchAll(USES_PATTERN)) {
      if (!pins.has(action)) pins.set(action, new Map());
      const refs = pins.get(action);
      if (!refs.has(ref)) refs.set(ref, []);
      refs.get(ref).push(path);
    }
  }
  return pins;
}

const pins = collectPins();
const conflicts = [...pins].filter(([, refs]) => refs.size > 1);

if (conflicts.length > 0) {
  console.error("同じ Action が別々の版に固定されています:\n");
  for (const [action, refs] of conflicts) {
    console.error(`  ${action}`);
    for (const [ref, files] of refs) {
      console.error(`    ${ref}`);
      for (const file of files) console.error(`      ${file}`);
    }
    console.error("");
  }
  console.error("どれか1つの版へ揃えてください。");
  process.exit(1);
}

const total = [...pins.values()].reduce((sum, refs) => sum + refs.size, 0);
console.info(`Action pin check passed: ${pins.size} actions, ${total} pins, no version conflicts.`);
