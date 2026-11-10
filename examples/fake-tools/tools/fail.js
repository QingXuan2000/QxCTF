#!/usr/bin/env node
// 假工具：以指定退出码结束，用来验证退出码透传与失败状态
const code = Number.parseInt(process.argv[2] ?? '3', 10);

console.log('[fail] 即将以退出码', code, '结束');
process.exit(Number.isNaN(code) ? 3 : code);
