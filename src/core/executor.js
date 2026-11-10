/**
 * 工具执行
 *
 * 分两步，彼此不耦合：
 * 1. planExecution() —— 把菜单项 + 架构偏好解析成一条确定的命令行和工作目录（纯函数）
 * 2. runPlan()       —— 真正 spawn 子进程，把终端交给它
 *
 * 拆开的好处是计划可以在不执行的情况下被打印、比对、写进日志（`qxctf run --dry-run`）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { archCandidates, detectArch } from './arch.js';
import { QxCtfError } from './errors.js';
/** 参数里出现这些字符时加引号，避免被 shell 拆开 */
const NEEDS_QUOTE = /[\s"&|<>^()$`]/;
/** 极简 shell 参数引用 */
export function quoteArg(value) {
    if (value === '') {
        return '""';
    }
    if (!NEEDS_QUOTE.test(value)) {
        return value;
    }
    return `"${value.replace(/"/g, '\\"')}"`;
}
/** 取路径映射里的可用架构键（键与值都非空） */
function availableArchKeys(spec) {
    return Object.entries(spec)
        .filter(([key, value]) => key.trim() !== '' && typeof value === 'string' && value.trim() !== '')
        .map(([key]) => key);
}
/**
 * 生成执行计划
 *
 * 架构匹配顺序：指定架构 → 系统架构 → X86_64 → 配置中第一个可用键。
 * 单条命令（字符串 path）直接使用，架构记为 default。
 */
export function planExecution(item, context) {
    if (item.type !== 'executable') {
        throw new QxCtfError(`菜单项 ${item.name} 不是可执行项`);
    }
    const spec = item.path;
    if (spec === undefined) {
        throw new QxCtfError(`菜单项 ${item.name} 缺少 path`);
    }
    const detected = context.detectedArch ?? detectArch();
    const order = archCandidates(context.preferredArch, detected);
    let base;
    let arch;
    let candidates;
    if (typeof spec === 'string') {
        base = spec.trim();
        arch = 'default';
        candidates = [];
    }
    else {
        const keys = availableArchKeys(spec);
        if (keys.length === 0) {
            throw new QxCtfError(`菜单项 ${item.name} 的 path 映射里没有任何非空命令`, '至少为一个架构键填写命令，例如 "X86_64": "...\\tool.exe"');
        }
        candidates = [...order.filter((key) => keys.includes(key)), ...keys.filter((key) => !order.includes(key))];
        const hit = candidates[0];
        if (hit === undefined) {
            throw new QxCtfError(`菜单项 ${item.name} 无法匹配任何架构路径`);
        }
        arch = hit;
        const command = spec[hit];
        if (command === undefined) {
            throw new QxCtfError(`菜单项 ${item.name} 的架构键 ${hit} 没有命令`);
        }
        base = command.trim();
    }
    if (base === '') {
        throw new QxCtfError(`菜单项 ${item.name} 的命令为空`);
    }
    const args = (item.args ?? []).map(quoteArg);
    const command = args.length > 0 ? `${base} ${args.join(' ')}` : base;
    const cwd = item.cwd !== undefined && item.cwd.trim() !== ''
        ? path.resolve(context.packageRoot, item.cwd)
        : path.resolve(context.packageRoot);
    return { item, command, arch, candidates, cwd };
}
/** 一行展示计划 */
export function formatPlan(plan) {
    const archPart = plan.arch === 'default' ? '通用命令' : `架构 ${plan.arch}`;
    return `${archPart} · ${plan.command}  (cwd: ${plan.cwd})`;
}
/** 执行计划，终端直接交给子进程 */
export function runPlan(plan) {
    return new Promise((resolve, reject) => {
        const child = spawn(plan.command, {
            shell: true,
            stdio: 'inherit',
            cwd: plan.cwd,
        });
        child.on('close', (code, signal) => {
            resolve({ code, signal });
        });
        child.on('error', (error) => {
            const code = error.code;
            const hint = code === 'ENOENT'
                ? `检查命令是否存在、cwd 是否存在：${plan.cwd}`
                : error.message;
            reject(new QxCtfError(`无法启动命令：${plan.command}`, hint));
        });
    });
}
/**
 * 执行计划，同时把输出透传到当前终端并保留尾部若干行。
 *
 * 用途：TUI 执行完要把最后几行显示在抽屉里，但又不能因为抓取输出而
 * 让长任务失去实时回显——所以是「透传 + 截尾」，不是纯 pipe。
 */
export function runPlanTee(plan, options = {}) {
    const maxLines = options.maxLines ?? 200;
    const tail = [];
    const absorb = (text) => {
        for (const line of text.split('\n')) {
            if (line.trim() === '') {
                continue;
            }
            tail.push(line.replace(/\r$/, ''));
        }
        while (tail.length > maxLines) {
            tail.shift();
        }
    };
    return new Promise((resolve, reject) => {
        const child = spawn(plan.command, {
            shell: true,
            stdio: ['inherit', 'pipe', 'pipe'],
            cwd: plan.cwd,
        });
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => {
            process.stdout.write(chunk);
            absorb(chunk);
        });
        child.stderr?.on('data', (chunk) => {
            process.stderr.write(chunk);
            absorb(chunk);
        });
        child.on('close', (code, signal) => {
            resolve({ code, signal, tail });
        });
        child.on('error', (error) => {
            const code = error.code;
            const hint = code === 'ENOENT'
                ? `检查命令是否存在、cwd 是否存在：${plan.cwd}`
                : error.message;
            reject(new QxCtfError(`无法启动命令：${plan.command}`, hint));
        });
    });
}
