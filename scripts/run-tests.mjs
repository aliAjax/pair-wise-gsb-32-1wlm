#!/usr/bin/env node
// 合并逻辑的离线测试运行器：用 esbuild 把 TS 源码与测试一起打包后用 node 执行。
// 不依赖浏览器 DOM（Element Plus 消息在测试里用最小 document 桩绕过）。
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tests = ['scripts/mergeEngine.test.mjs', 'scripts/syncStore.test.mjs'];
const dir = mkdtempSync(join(tmpdir(), 'tripweaver-test-'));
let failed = false;

for (const entry of tests) {
  const out = join(dir, entry.replace(/[\\/]/g, '-') + '.bundle.mjs');
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning' });
  const proc = spawnSync(process.execPath, [out], { stdio: 'inherit' });
  if (proc.status !== 0) {
    failed = true;
    break;
  }
}
rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
