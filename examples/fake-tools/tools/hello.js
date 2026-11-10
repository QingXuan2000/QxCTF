#!/usr/bin/env node
// 假工具：打印参数、cwd、运行时信息，用来验证 args 引用与工作目录
const args = process.argv.slice(2);

console.log('[hello] argv   =', JSON.stringify(args));
console.log('[hello] cwd    =', process.cwd());
console.log('[hello] runtime=', `${process.platform}/${process.arch}`, 'node', process.version);
console.log('[hello] 中文输出正常 · box: ┌─┐ │ └─┘');
process.exit(0);
