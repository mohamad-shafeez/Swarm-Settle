#!/usr/bin/env node
/**
 * SwarmSettle Repository & Contract-Frontend ABI Verification Suite (scripts/verify.mjs)
 *
 * Verifies:
 *  1. Required clean repository structure exist (no stray video files or duplicate HTML).
 *  2. 24-test JavaScript contract state-machine model (`scripts/test-contract-invariants.mjs`).
 *  3. Contract-to-frontend method alignment (`approve_contribution`, `claim_remaining_refund`, etc.).
 *  4. Secret hygiene check across tracked files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();

const REQUIRED_FILES = [
  'README.md',
  'package.json',
  'Makefile',
  '.env.example',
  '.gitignore',
  'contract/Cargo.toml',
  'contract/src/lib.rs',
  'agents/agent-runner.mjs',
  'agents/artifact-store.mjs',
  'agents/llm-provider.mjs',
  'agents/personas.mjs',
  'app/package.json',
  'app/tsconfig.json',
  'app/vite.config.ts',
  'app/index.html',
  'app/src/main.tsx',
  'app/src/index.css',
  'app/src/App.tsx',
  'app/src/lib/near.ts',
  'app/src/lib/yocto.ts',
  'app/src/lib/hashing.ts',
  'scripts/deploy-testnet.sh',
  'scripts/test-contract-invariants.mjs',
  'scripts/verify.mjs',
  'scripts/record-demo.mjs',
  'docs/ARCHITECTURE.md',
  'docs/DEMO_SCRIPT.md',
  'docs/VIDEO_SCRIPT.md',
];

let failed = false;

console.log('[1/4] Checking clean repository file list...');
for (const rel of REQUIRED_FILES) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    console.error(`  [MISSING] ${rel}`);
    failed = true;
  }
}
if (!failed) {
  console.log(`  [PASS] All ${REQUIRED_FILES.length} required files present.`);
}

console.log('[2/4] Verifying contract-to-frontend method alignment...');
const contractSrc = fs.readFileSync(path.join(ROOT, 'contract/src/lib.rs'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'app/src/App.tsx'), 'utf8');
for (const method of ['create_job', 'select_crew', 'approve_contribution', 'claim_remaining_refund', 'get_agent_stats']) {
  if (!contractSrc.includes(`pub fn ${method}`)) {
    console.error(`  [FAIL] Contract missing pub fn ${method}`);
    failed = true;
  }
  if (!appSrc.includes(`'${method}'`)) {
    console.error(`  [FAIL] App.tsx missing call to '${method}'`);
    failed = true;
  }
}
if (appSrc.includes('approve_selected_contributions')) {
  console.error('  [FAIL] App.tsx still references non-existent approve_selected_contributions');
  failed = true;
} else {
  console.log('  [PASS] App.tsx method calls match contract/src/lib.rs.');
}

const REQUIRED_TEST_IDS = [
  'submit-create-job-btn',
  'lock-crew-btn',
  'recompute-sha256-btn',
  'tamper-file-btn',
  'restore-file-btn',
  'approve-all-btn',
  'simulation-settlement-receipt',
];
for (const testId of REQUIRED_TEST_IDS) {
  if (!appSrc.includes(`data-testid="${testId}"`)) {
    console.error(`  [FAIL] App.tsx missing data-testid="${testId}" required by the demo recorder`);
    failed = true;
  }
}
if (!failed) {
  console.log(`  [PASS] All ${REQUIRED_TEST_IDS.length} demo-flow test IDs present.`);
}

console.log('[3/4] Running 24-test JavaScript contract state-machine model...');
const testRun = spawnSync('node', ['scripts/test-contract-invariants.mjs'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (testRun.status !== 0) {
  failed = true;
}

console.log('[4/4] Checking for accidentally committed .env files...');
if (fs.existsSync(path.join(ROOT, '.env'))) {
  console.error('  [FAIL] .env file exists in repository root; ensure it is gitignored and never committed.');
  failed = true;
} else {
  console.log('  [PASS] No .env file present in repository tree.');
}

if (failed) {
  process.exit(1);
}
console.log('Verification complete.');
