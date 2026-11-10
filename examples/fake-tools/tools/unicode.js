#!/usr/bin/env node
// 假工具：输出中文、框线字符与混合宽度文本，用来检查多字节渲染
const rows = [
  ['目标', '状态', 'RTT(ms)'],
  ['10.0.0.1', '开放', '12'],
  ['10.0.0.2', '过滤', '-'],
];

const widths = [12, 8, 8];
const line = (cells) => cells.map((cell, index) => pad(cell, widths[index])).join(' │ ');

function pad(text, width) {
  // 中文按 2 列宽计算，简单够用的近似实现
  const visual = [...text].reduce((sum, ch) => sum + (ch.codePointAt(0) > 0x2e80 ? 2 : 1), 0);
  return text + ' '.repeat(Math.max(0, width - visual));
}

console.log('┌' + '─'.repeat(widths.reduce((sum, w) => sum + w + 3, -3)) + '┐');
for (const row of rows) {
  console.log('│ ' + line(row) + ' │');
}
console.log('└' + '─'.repeat(widths.reduce((sum, w) => sum + w + 3, -3)) + '┘');
console.log('混合：ASCII mixed 中文 → ★ ✓ 0x7f');
process.exit(0);
