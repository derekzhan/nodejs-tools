import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function runCLI(args, options = {}) {
  const result = spawnSync('node', ['index.js', ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C' },
    ...options,
  });
  return result;
}

test('captures context and stack traces for Spring-style logs', () => {
  const result = runCLI([
    '--file', 'fixtures/spring-sample.log',
    '--level', 'ERROR',
    '--context-before', '1',
    '--context-after', '1',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[BEFORE\].*Preparing services/);
  assert.match(result.stdout, /\[MATCH\].*Something bad happened/);
  assert.match(result.stdout, /RuntimeException: Boom/);
  assert.match(result.stdout, /\[AFTER\].*Completed startup/);
});

test('thread filters apply to single-hyphen log headers', () => {
  const result = runCLI([
    '--file', 'fixtures/threaded.log',
    '--level', 'ERROR',
    '--thread', 'Thread-1',
    '--json',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `expected exactly one result, got ${lines.length}`);
  const payload = JSON.parse(lines[0]);
  assert.equal(payload.thread, 'Thread-1');
  assert.match(payload.message, /Worker failed/);
});

test('JSONL index produces identical output for repeat queries', () => {
  const filterArgs = [
    '--level', 'ERROR',
    '--keyword', 'RuntimeException',
    '--context-before', '1',
    '--context-after', '0',
  ];

  const direct = runCLI([
    '--file', 'fixtures/spring-sample.log',
    ...filterArgs,
  ]);
  assert.equal(direct.status, 0, direct.stderr);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logctx-'));
  const indexPath = path.join(tmpDir, 'spring.idx');

  try {
    const buildIndex = runCLI([
      '--file', 'fixtures/spring-sample.log',
      '--write-index', indexPath,
      ...filterArgs,
    ]);
    assert.equal(buildIndex.status, 0, buildIndex.stderr);
    assert.ok(fs.existsSync(indexPath), 'expected index to be created');

    const viaIndex = runCLI([
      '--file', 'fixtures/spring-sample.log',
      '--read-index', indexPath,
      ...filterArgs,
    ]);
    assert.equal(viaIndex.status, 0, viaIndex.stderr);
    assert.equal(viaIndex.stdout, direct.stdout);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
