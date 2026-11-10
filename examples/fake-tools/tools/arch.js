#!/usr/bin/env node
// 假工具：回显被选中的架构键，用来验证 path 的架构映射
const token = process.argv[2] ?? '(none)';

console.log('[arch] 菜单选中架构键 =', token);
console.log('[arch] 真实进程架构   =', process.arch);
process.exit(0);
