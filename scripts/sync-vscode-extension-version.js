#!/usr/bin/env node
/**
 * Syncs the VSCode extension version with the main package.json version
 * This ensures both packages always have the same version number
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Read main package.json
const mainPackagePath = join(rootDir, 'package.json');
const mainPackage = JSON.parse(readFileSync(mainPackagePath, 'utf-8'));
const mainVersion = mainPackage.version;

if (!mainVersion) {
  console.error('❌ Error: Could not read version from main package.json');
  process.exit(1);
}

// Read VSCode extension package.json
const vscodePackagePath = join(rootDir, 'vscode-extension', 'package.json');
const vscodePackage = JSON.parse(readFileSync(vscodePackagePath, 'utf-8'));
const currentVscodeVersion = vscodePackage.version;

if (currentVscodeVersion === mainVersion) {
  console.log(`✅ Versions already in sync: ${mainVersion}`);
  process.exit(0);
}

// Update VSCode extension version
vscodePackage.version = mainVersion;
writeFileSync(
  vscodePackagePath,
  JSON.stringify(vscodePackage, null, 2) + '\n',
  'utf-8',
);

console.log(
  `✅ Synced VSCode extension version: ${currentVscodeVersion} → ${mainVersion}`,
);
