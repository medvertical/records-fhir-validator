import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const TARGET_ROOTS = process.argv.slice(2).length > 0
  ? process.argv.slice(2).map((target) => path.resolve(target))
  : [
  path.resolve("dist/server"),
];

const RELATIVE_IMPORT = /(\bfrom\s+['"])(\.{1,2}\/[^'"]+)(['"])/g;
const DYNAMIC_IMPORT = /(import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g;

const VALID_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".json", ".node"]);

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function collectJsFiles(root: string): Promise<string[]> {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(entryPath);
    }
  }

  return files;
}

function needsRewrite(baseFile: string, specifier: string): boolean {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return false;
  }
  if (specifier.includes("?") || specifier.includes("#")) {
    return false;
  }
  const withoutQuery = specifier.split(/[?#]/)[0]!;
  const ext = path.extname(withoutQuery);
  if (ext === "" || !VALID_EXTENSIONS.has(ext)) {
    return true;
  }

  if (withoutQuery.endsWith(".js.js")) {
    return true;
  }

  if (withoutQuery.endsWith("/index.js")) {
    const baseDir = path.dirname(baseFile);
    const baseSpecifier = withoutQuery.slice(0, -"/index.js".length);
    const absolute = path.resolve(baseDir, baseSpecifier);
    
    // Don't rewrite if the index.js file actually exists
    const indexFileCandidate = path.join(absolute, "index.js");
    if (fs.existsSync(indexFileCandidate)) {
      return false;
    }
    
    // Only rewrite if index.js doesn't exist but a .js file with the directory name does
    if (fs.existsSync(`${absolute}.js`)) {
      return true;
    }
  }

  return false;
}

async function resolveSpecifier(baseFile: string, specifier: string): Promise<string> {
  const baseDir = path.dirname(baseFile);
  const withoutQuery = specifier.split(/[?#]/)[0]!;
  const absolute = path.resolve(baseDir, withoutQuery);

  if (withoutQuery.endsWith(".js.js")) {
    const trimmed = withoutQuery.slice(0, -3);
    const absTrimmed = path.resolve(baseDir, trimmed);
    if (fs.existsSync(absTrimmed)) {
      let relative = path.relative(baseDir, absTrimmed).replace(/\\/g, "/");
      if (!relative.startsWith(".")) {
        relative = `./${relative}`;
      }
      return relative;
    }
  }

  if (withoutQuery.endsWith("/index.js")) {
    const baseSpecifier = withoutQuery.slice(0, -"/index.js".length);
    const baseAbsolute = path.resolve(baseDir, baseSpecifier);
    
    // First check if the index.js file actually exists (don't rewrite if it does)
    const indexFileCandidate = path.join(baseAbsolute, "index.js");
    if (fs.existsSync(indexFileCandidate)) {
      // The index.js file exists, so keep the import as-is
      return specifier;
    }
    
    // Only rewrite if index.js doesn't exist but a .js file with the directory name does
    const fileCandidate = `${baseAbsolute}.js`;
    if (fs.existsSync(fileCandidate)) {
      let relative = path.relative(baseDir, fileCandidate).replace(/\\/g, "/");
      if (!relative.startsWith(".")) {
        relative = `./${relative}`;
      }
      return relative;
    }
  }

  const candidates = [
    `${absolute}.js`,
    path.join(absolute, "index.js"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      let relative = path.relative(baseDir, candidate).replace(/\\/g, "/");
      if (!relative.startsWith(".")) {
        relative = `./${relative}`;
      }
      return relative;
    }
  }

  return specifier.endsWith("/")
    ? `${specifier}index.js`
    : `${specifier}.js`;
}

async function rewriteImports(filePath: string, content: string): Promise<string> {
  const replacements: Array<{
    start: number;
    end: number;
    value: string;
  }> = [];

  const matcher = async (regex: RegExp, match: RegExpExecArray) => {
    const [full, prefix, specifier, suffix] = match;
    if (!needsRewrite(filePath, specifier)) {
      return;
    }

    const resolved = await resolveSpecifier(filePath, specifier);
    replacements.push({
      start: match.index,
      end: match.index + full.length,
      value: `${prefix}${resolved}${suffix}`,
    });
  };

  // Collect matches sequentially to avoid overlapping replacements
  for (const regex of [new RegExp(RELATIVE_IMPORT, "g"), new RegExp(DYNAMIC_IMPORT, "g")]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      // eslint-disable-next-line no-await-in-loop
      await matcher(regex, match);
    }
  }

  if (replacements.length === 0) {
    return content;
  }

  replacements.sort((a, b) => a.start - b.start);

  let result = "";
  let cursor = 0;
  for (const { start, end, value } of replacements) {
    result += content.slice(cursor, start);
    result += value;
    cursor = end;
  }
  result += content.slice(cursor);

  return result;
}

async function processFile(filePath: string): Promise<void> {
  const original = await fsp.readFile(filePath, "utf8");
  const updated = await rewriteImports(filePath, original);
  if (updated !== original) {
    await fsp.writeFile(filePath, updated, "utf8");
  }
}

async function processRoot(root: string): Promise<void> {
  try {
    await fsp.access(root);
  } catch {
    return;
  }

  const files = await collectJsFiles(root);
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await processFile(file);
  }
}

async function main(): Promise<void> {
  for (const root of TARGET_ROOTS) {
    // eslint-disable-next-line no-await-in-loop
    await processRoot(root);
  }
}

main().catch((error) => {
  console.error("[fix-esm-specifiers] Failed to patch ESM specifiers:", error);
  process.exitCode = 1;
});
