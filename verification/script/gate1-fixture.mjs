import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {unknown} value @param {string} context */
const record = (value, context) => {
  if (!isRecord(value)) throw new Error(`${context}: expected object`);
  return value;
};

/** @param {unknown} value @param {string} context */
const text = (value, context) => {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${context}: expected string`);
  return value;
};

/** @param {unknown} value @param {string} context */
const array = (value, context) => {
  if (!Array.isArray(value)) throw new Error(`${context}: expected array`);
  // JSON.parse由来の暗黙anyを検査境界の外へ出さない。
  return Array.from(value, (item) => record(item, context));
};

/** @param {unknown} value @param {string} context */
const group = (value, context) => {
  if (!Array.isArray(value) || value.length !== 9)
    throw new Error(`${context}: expected nine pairs`);
  const numbers = Array.from(value, (item) => {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 7 || item > 24) {
      throw new Error(`${context}: invalid pair`);
    }
    return item;
  });
  if (new Set(numbers).size !== 9) throw new Error(`${context}: duplicate pair`);
  return numbers;
};

/** @param {unknown} value @param {string} directory */
const parseExpectation = (value, directory) => {
  const raw = record(value, directory);
  if (raw.pairId !== directory || raw.figmaFrame !== "figma-export.png") {
    throw new Error(`${directory}: invalid pairId or reference path`);
  }
  const names = new Set();
  const images = new Set();
  const variants = array(raw.variants, directory).map((v) => {
    const name = text(v.name, directory);
    const image = text(v.image, directory);
    if (!/^(correct|drift-[12]px|linewidth)$/.test(name) || image !== `impl-${name}.png`) {
      throw new Error(`${directory}: invalid variant or image path`);
    }
    if (names.has(name) || images.has(image)) throw new Error(`${directory}: duplicate variant`);
    names.add(name);
    images.add(image);
    const expectedVerdict = text(v.expectedVerdict, directory);
    if (!["pass", "fail"].includes(expectedVerdict))
      throw new Error(`${directory}: invalid verdict`);
    const knownRedIssue = v.knownRedIssue === undefined ? null : text(v.knownRedIssue, directory);
    return { name, image, expectedVerdict, knownRedIssue };
  });
  if (variants.filter((v) => v.name === "correct").length !== 1) {
    throw new Error(`${directory}: expected one correct variant`);
  }
  return { pairId: directory, figmaFrame: "figma-export.png", variants };
};

/** @param {unknown} definitionValue
 * @param {{directory: string, bytes: Buffer}[]} entries */
export const validateGate1Fixtures = (definitionValue, entries) => {
  const definition = record(definitionValue, "definition");
  const pass = group(definition.passPairs, "passPairs");
  const fail = group(definition.failPairs, "failPairs");
  if (new Set([...pass, ...fail]).size !== 18) throw new Error("Groups overlap");
  const fixtures = record(definition.fixtures, "fixtures");
  if (entries.length !== 18 || Object.keys(fixtures).length !== 18) {
    throw new Error("Expected exactly 18 fixture identities");
  }
  const seen = new Set();
  const pairNumbers = new Set();
  const result = entries.map(({ directory, bytes }) => {
    if (!/^pair-\d{2}-hm-gate1-\d+-\d+$/.test(directory) || seen.has(directory)) {
      throw new Error(`${directory}: invalid or duplicate directory`);
    }
    seen.add(directory);
    const number = Number(directory.split("-")[1]);
    if (![...pass, ...fail].includes(number) || pairNumbers.has(number)) {
      throw new Error(`${directory}: unexpected or duplicate pair number`);
    }
    pairNumbers.add(number);
    const contract = record(fixtures[directory], directory);
    const expectation = parseExpectation(JSON.parse(bytes.toString("utf8")), directory);
    const contracts = array(contract.variants, directory).map((v) => ({
      name: text(v.variant, directory),
      expectedVerdict: text(v.expectedVerdict, directory),
      knownRedIssue: v.knownRedIssue === null ? null : text(v.knownRedIssue, directory),
    }));
    const actual = expectation.variants.map(({ name, expectedVerdict, knownRedIssue }) => ({
      name,
      expectedVerdict,
      knownRedIssue,
    }));
    if (JSON.stringify(actual) !== JSON.stringify(contracts)) {
      throw new Error(`${directory}: variant contract changed`);
    }
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
    if (expectedSha256 !== contract.expectedSha256)
      throw new Error(`${directory}: expectation hash changed`);
    const groupName = pass.includes(number) ? "pass" : "fail";
    if (expectation.variants.find((v) => v.name === "correct")?.expectedVerdict !== groupName) {
      throw new Error(`${directory}: group label changed`);
    }
    return { directory, expectation, group: groupName, expectedSha256 };
  });
  if (result.reduce((count, r) => count + r.expectation.variants.length, 0) !== 33) {
    throw new Error("Expected exactly 33 variant identities");
  }
  return result;
};

/** @param {string} fixtureRoot */
export const loadGate1Fixtures = async (fixtureRoot) => {
  const definitionBytes = await readFile(path.join(fixtureRoot, "gate1-independent-oracle.json"));
  const directories = (await readdir(fixtureRoot))
    .filter((d) => /^pair-\d+-hm-gate1-/.test(d))
    .sort();
  const entries = [];
  for (const directory of directories) {
    entries.push({
      directory,
      bytes: await readFile(path.join(fixtureRoot, directory, "expected.json")),
    });
  }
  return {
    definitionSha256: createHash("sha256").update(definitionBytes).digest("hex"),
    fixtures: validateGate1Fixtures(JSON.parse(definitionBytes.toString("utf8")), entries),
  };
};
