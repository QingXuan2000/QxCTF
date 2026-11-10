#!/usr/bin/env node
// 假工具：逐行回显 stdin，输入 quit / exit 或 EOF 结束，用来验证交互式工具
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let lines = 0;

console.log('[echo] 输入一行回一行；输入 quit 结束');

rl.on('line', (line) => {
  const text = line.trim();
  lines += 1;
  if (text === 'quit' || text === 'exit') {
    console.log(`[echo] 收到结束指令，共 ${lines} 行`);
    rl.close();
    return;
  }
  console.log(`[echo] #${lines} <${text}> 长度 ${[...text].length}`);
});

rl.on('close', () => {
  process.exit(0);
});
