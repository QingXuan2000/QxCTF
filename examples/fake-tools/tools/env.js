#!/usr/bin/env node
// 假工具：打印与环境相关的关键值，用来验证子进程继承了正确的环境与 cwd
const keys = ['QXCTF_HOME', 'QXCTF_CONFIG', 'NODE_ENV'];

console.log('[env] cwd      =', process.cwd());
console.log('[env] execPath =', process.execPath);
console.log('[env] PATH 项数=', (process.env['PATH'] ?? process.env['Path'] ?? '').split(process.platform === 'win32' ? ';' : ':').length);
for (const key of keys) {
  console.log(`[env] ${key} =`, process.env[key] ?? '(未设置)');
}
process.exit(0);
