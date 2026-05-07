#!/usr/bin/env node
/**
 * npx @react-scan-cli/skills
 *
 * Installs all react-scan-cli Claude Code skills into the current project's
 * .claude/skills/ directory.
 *
 * Usage:
 *   npx @react-scan-cli/skills
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillsSrc = join(__dirname, '../skills');
const skillsDest = join(process.cwd(), '.claude/skills');

let installed = 0;
let updated = 0;

// Each subdirectory under skills/ is a skill
for (const skillName of readdirSync(skillsSrc)) {
  const srcDir = join(skillsSrc, skillName);
  if (!statSync(srcDir).isDirectory()) continue;

  const srcFile = join(srcDir, 'SKILL.md');
  if (!existsSync(srcFile)) continue;

  const destDir = join(skillsDest, skillName);
  const destFile = join(destDir, 'SKILL.md');

  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  const isNew = !existsSync(destFile);
  copyFileSync(srcFile, destFile);

  if (isNew) {
    console.log(`✔ Installed  .claude/skills/${skillName}/SKILL.md`);
    installed++;
  } else {
    console.log(`✔ Updated    .claude/skills/${skillName}/SKILL.md`);
    updated++;
  }
}

console.log('');
console.log(`${installed + updated} skill(s) ready.`);
console.log('');
console.log('In your Claude Code session, type:');
console.log('  /react-scan-cli          ← guided setup');
console.log('');
console.log('Or with arguments:');
console.log('  /react-scan-cli setup    ← plugin + GitHub Actions');
console.log('  /react-scan-cli plugin   ← plugin only');
console.log('  /react-scan-cli workflow ← GitHub Actions only');
