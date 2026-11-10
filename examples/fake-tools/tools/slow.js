#!/usr/bin/env node
// 假工具：睡一会儿再返回，用来验证执行期间终端被接管、结束后界面恢复
const ms = Number.parseInt(process.argv[2] ?? '500', 10);
const started = Date.now();

console.log(`[slow] 等待 ${ms}ms ...`);
setTimeout(() => {
  console.log(`[slow] 实际等待 ${Date.now() - started}ms，结束`);
  process.exit(0);
}, Number.isNaN(ms) ? 500 : ms);
