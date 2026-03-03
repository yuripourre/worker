#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import path from "path";

console.log("🔧 Building Worker package...");

const outdir = path.join(process.cwd(), "dist");

if (existsSync(outdir)) {
  console.log(`🗑️ Cleaning previous build at ${outdir}`);
  await rm(outdir, { recursive: true, force: true });
}

try {
  // Create dist directory
  await $`mkdir -p dist`;

  // Compile main files
  await $`bun build src/index.ts --outdir dist --target node --format esm`;
  await $`bun build src/cli.ts --outdir dist --target node --format esm`;
  await $`bun build src/worker.ts --outdir dist --target node --format esm`;

  // Compile execution files
  await $`bun build src/execution/**/*.ts --outdir dist/execution --target node --format esm`;

  // Compile services
  await $`bun build src/services/**/*.ts --outdir dist/services --target node --format esm`;

  // Skip TypeScript compilation for now due to type issues
  // await $`tsc --declaration --emitDeclarationOnly --outDir dist --project tsconfig.build.json`;

  // Copy types file
  await $`cp src/types.ts dist/`;

  // Copy vendored shared into dist so dist/types.ts re-exports resolve
  await $`cp -r src/shared dist/`;

  // Copy package.json to dist
  await $`cp package.json dist/`;

  console.log("✅ Worker package built successfully");
} catch (error) {
  console.error("❌ Failed to build Worker package:", error);
  process.exit(1);
}
