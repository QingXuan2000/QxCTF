#!/usr/bin/env node
/**
 * QxCTF 命令行入口
 *
 * 不带子命令时进入全屏 TUI；带子命令时走非交互路径，方便脚本与 CI：
 *   qxctf                     启动 TUI
 *   qxctf run <目标>          直接执行一个工具
 *   qxctf list [--json]       打印菜单树
 *   qxctf path                打印当前配置目录
 *   qxctf doctor              环境自检
 *   qxctf packages [add|remove|list]
 *   qxctf config <目录>       指定当前工具包
 *   qxctf init [目录]         生成示例工具包
 */
import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTui } from './tui/app.js';
import { loadBootstrap, tryLoadBootstrap } from './core/bootstrap.js';
import { runDoctor } from './core/doctor.js';
import { describeError } from './core/errors.js';
import { formatPlan, planExecution, runPlan } from './core/executor.js';
import { createLoader } from './core/loader.js';
import { actionFor, isListableItem, resolveTarget } from './core/menu.js';
import { addPackage, listPackages, packageSummary, removePackage } from './core/packages.js';
import { dataDir, packageRootOf, readSavedConfigDir, resolveConfigDir, writeSavedConfigDir, } from './core/paths.js';
import { scaffoldConfig } from './core/scaffold.js';
import { PRODUCT, TAGLINE, VERSION } from './version.js';
// ---------- 终端着色 ----------
const useColor = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;
const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = (text) => paint(2, text);
const bold = (text) => paint(1, text);
const cyan = (text) => paint(36, text);
const green = (text) => paint(32, text);
const yellow = (text) => paint(33, text);
const red = (text) => paint(31, text);
const defaultFlags = () => ({
    config: null,
    arch: null,
    dryRun: false,
    json: false,
    tui: false,
    force: false,
    help: false,
    version: false,
});
function parseArgs(argv) {
    const flags = defaultFlags();
    const positionals = [];
    let command = null;
    let literal = false;
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === undefined) {
            continue;
        }
        if (literal) {
            positionals.push(token);
            continue;
        }
        if (token === '--') {
            literal = true;
            continue;
        }
        if (token === '-h' || token === '--help') {
            flags.help = true;
            continue;
        }
        if (token === '-v' || token === '--version') {
            flags.version = true;
            continue;
        }
        if (token === '-n' || token === '--dry-run') {
            flags.dryRun = true;
            continue;
        }
        if (token === '--json') {
            flags.json = true;
            continue;
        }
        if (token === '--tui') {
            flags.tui = true;
            continue;
        }
        if (token === '-f' || token === '--force') {
            flags.force = true;
            continue;
        }
        if (token === '-c' || token === '--config') {
            const next = argv[index + 1];
            if (next !== undefined) {
                flags.config = next;
                index += 1;
            }
            continue;
        }
        if (token === '-a' || token === '--arch') {
            const next = argv[index + 1];
            if (next !== undefined) {
                flags.arch = next;
                index += 1;
            }
            continue;
        }
        if (token.startsWith('--config=')) {
            flags.config = token.slice('--config='.length);
            continue;
        }
        if (token.startsWith('--arch=')) {
            flags.arch = token.slice('--arch='.length);
            continue;
        }
        if (token.startsWith('-') && token !== '-') {
            continue;
        }
        if (command === null) {
            command = token;
        }
        else {
            positionals.push(token);
        }
    }
    return { command, positionals, flags };
}
// ---------- 帮助 ----------
function usage() {
    const lines = [
        `${bold(PRODUCT)} v${VERSION} — ${TAGLINE}`,
        '',
        '用法',
        `  ${cyan('qxctf')}                          启动全屏 TUI`,
        `  ${cyan('qxctf run <目标>')} [--arch X86_64] [--dry-run]`,
        '                                    直接执行工具（目标：menu:id / id / 名称）',
        `  ${cyan('qxctf list')} [--json]          打印菜单树`,
        `  ${cyan('qxctf path')}                   打印当前配置目录与数据目录`,
        `  ${cyan('qxctf doctor')} [--json]        环境自检`,
        `  ${cyan('qxctf packages')} [list]        查看已保存工具包`,
        `  ${cyan('qxctf packages add <目录>')}    添加工具包`,
        `  ${cyan('qxctf packages remove <目录>')} 移除工具包`,
        `  ${cyan('qxctf config <目录>')}          指定当前工具包并持久化`,
        `  ${cyan('qxctf init [目录]')} [--force]  生成示例工具包`,
        '',
        '全局选项',
        '  -c, --config <目录>   本次使用的工具包目录（覆盖已保存路径）',
        '  -a, --arch <架构>     指定目标架构：X86_64 / X86 / ARM64 / ARM32',
        '  -n, --dry-run         只打印执行计划，不真正运行',
        '  --json                机器可读输出',
        '  --tui                 非 TTY 环境下也强制启动 TUI',
        '  -f, --force           init 时覆盖已有文件',
        '  -h, --help            显示本帮助',
        '  -v, --version         显示版本',
        '',
        'TUI 快捷键',
        '  ↑↓ j k 移动   Enter 进入/执行   1-9 切菜单   Tab 轮换菜单',
        '  / 过滤   a 架构   p 工具包   d 自检   o 输出   r 重载',
        '  b/← 返回上级   m/→ 主菜单   ? 帮助   q / Ctrl+C 退出',
        '  鼠标：点侧边栏切菜单，点列表行选中，再点一次执行，滚轮滚动',
    ];
    return lines.join('\n');
}
// ---------- 各子命令 ----------
function bootstrapFor(flags) {
    return loadBootstrap({ configDir: flags.config });
}
function listCommand(flags) {
    const bootstrap = bootstrapFor(flags);
    if (flags.json) {
        const payload = {
            product: PRODUCT,
            version: VERSION,
            configDir: bootstrap.configDir,
            packageRoot: bootstrap.packageRoot,
            package: bootstrap.packageInfo,
            arch: bootstrap.arch,
            os: bootstrap.os,
            menus: Object.fromEntries(Object.entries(bootstrap.config.menu).map(([menuId, node]) => [
                menuId,
                {
                    title: node.title,
                    parent: node.parent ?? null,
                    items: node.items.filter((item) => isListableItem(item)).map((item) => ({
                        id: item.id,
                        name: item.name,
                        type: item.type,
                        desc: item.desc ?? null,
                        detail: item.detail ?? null,
                        submenu: item.submenu ?? null,
                        plan: item.type === 'executable'
                            ? (() => {
                                try {
                                    const plan = planExecution(item, { packageRoot: bootstrap.packageRoot });
                                    return { arch: plan.arch, command: plan.command, cwd: plan.cwd };
                                }
                                catch (error) {
                                    return { error: describeError(error) };
                                }
                            })()
                            : null,
                    })),
                },
            ])),
        };
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return 0;
    }
    const out = [];
    out.push(`${bold(PRODUCT)} v${VERSION} ${dim('·')} ${bootstrap.packageInfo.name} ${bootstrap.packageInfo.version}`);
    out.push(`${dim('配置目录')} ${bootstrap.configDir}`);
    out.push(`${dim('工具包根')} ${bootstrap.packageRoot}`);
    out.push(`${dim('平台架构')} ${bootstrap.arch} ${dim('·')} ${bootstrap.os} ${dim('· node')} ${bootstrap.node}`);
    out.push('');
    for (const [menuId, node] of Object.entries(bootstrap.config.menu)) {
        const title = node.title.replace(/\n/g, ' ').trim();
        const parent = node.parent !== undefined ? dim(` (parent: ${node.parent})`) : '';
        out.push(`${cyan(`[${menuId}]`)} ${bold(title === '' ? menuId : title)}${parent}`);
        let lastSection = '';
        for (const item of node.items.filter((candidate) => isListableItem(candidate))) {
            // 与 TUI 一致：分区在条目上方单列一行
            const section = (item.section ?? '').trim();
            if (section !== '' && section !== lastSection) {
                out.push(`  ${cyan(section)}`);
            }
            lastSection = section;
            const badge = item.type === 'submenu'
                ? dim(`-> ${item.submenu ?? '?'}`)
                : item.type === 'executable'
                    ? (() => {
                        try {
                            const plan = planExecution(item, { packageRoot: bootstrap.packageRoot });
                            return dim(`[${plan.arch}] ${plan.command}`);
                        }
                        catch (error) {
                            return red(describeError(error));
                        }
                    })()
                    : dim(item.type);
            out.push(`  ${String(item.id).padStart(2, ' ')}  ${item.name}  ${badge}`);
        }
        out.push('');
    }
    process.stdout.write(`${out.join('\n')}\n`);
    return 0;
}
function pathCommand(flags) {
    const configDir = flags.config !== null ? resolveConfigDir(flags.config) : readSavedConfigDir();
    const lines = [];
    lines.push(`${dim('配置目录')} ${configDir ?? red('未配置')}`);
    lines.push(`${dim('工具包根')} ${configDir === null ? '-' : packageRootOf(configDir)}`);
    lines.push(`${dim('数据目录')} ${dataDir()}`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return 0;
}
function doctorCommand(flags) {
    const report = runDoctor(flags.config);
    if (flags.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return report.ok ? 0 : 1;
    }
    const out = [`${bold(PRODUCT)} 环境自检`];
    for (const check of report.checks) {
        const mark = check.level === 'ok' ? green('OK  ') : check.level === 'warn' ? yellow('WARN') : red('FAIL');
        out.push(`${mark} ${check.name.padEnd(16, ' ')} ${dim(check.detail)}`);
    }
    out.push(report.ok ? green('自检通过') : red('存在失败项，按上面提示修复后重试'));
    process.stdout.write(`${out.join('\n')}\n`);
    return report.ok ? 0 : 1;
}
async function runCommand(positionals, flags) {
    if (positionals.length === 0) {
        process.stderr.write(`${red('缺少目标')}  用法：qxctf run <menu:id | id | 名称>\n`);
        return 1;
    }
    const bootstrap = bootstrapFor(flags);
    const expression = positionals.join(' ');
    const target = resolveTarget(bootstrap.config, expression);
    let action;
    try {
        action = actionFor(target.item, bootstrap.config);
    }
    catch (error) {
        process.stderr.write(`${red(describeError(error))}\n`);
        return 1;
    }
    if (action.kind === 'submenu') {
        const node = bootstrap.config.menu[action.menuId];
        process.stderr.write(`${yellow('目标是一个子菜单')}  ${action.menuId}\n${(node?.items ?? [])
            .map((item) => `  ${String(item.id).padStart(2, ' ')}  ${item.name}`)
            .join('\n')}\n${dim('用 qxctf run <menuId>:<id> 指定具体项')}\n`);
        return 1;
    }
    const item = target.item;
    if (action.kind !== 'executable') {
        process.stderr.write(`${yellow('该菜单项不是可执行项')}  ${item.name}（type=${action.kind}）\n` +
            `${dim('可执行项请用 qxctf list 查看 [arch] 标注的条目')}\n`);
        return 1;
    }
    const plan = planExecution(item, {
        packageRoot: bootstrap.packageRoot,
        preferredArch: flags.arch,
    });
    if (flags.dryRun) {
        process.stdout.write(`${bold('执行计划')}\n  ${formatPlan(plan)}\n`);
        return 0;
    }
    process.stdout.write(`${cyan('[QxCTF]')} ${item.name}\n  ${dim(formatPlan(plan))}\n\n`);
    const outcome = await runPlan(plan);
    if (outcome.code === null) {
        process.stdout.write(`\n${yellow('进程被信号终止')} ${outcome.signal ?? ''}\n`);
        return 1;
    }
    if (outcome.code !== 0) {
        process.stdout.write(`\n${red(`退出码 ${outcome.code}`)}\n`);
    }
    return outcome.code;
}
function packagesCommand(positionals, flags) {
    const sub = positionals[0] ?? 'list';
    if (sub === 'add') {
        const target = positionals[1];
        if (target === undefined) {
            process.stderr.write(`${red('缺少目录')}  用法：qxctf packages add <目录>\n`);
            return 1;
        }
        const packages = addPackage(target);
        process.stdout.write(`${green('已添加')} ${resolveConfigDir(target)}\n`);
        process.stdout.write(`${dim(`当前共 ${packages.length} 个工具包`)}\n`);
        return 0;
    }
    if (sub === 'remove' || sub === 'rm') {
        const target = positionals[1];
        if (target === undefined) {
            process.stderr.write(`${red('缺少目录')}  用法：qxctf packages remove <目录>\n`);
            return 1;
        }
        const packages = removePackage(target);
        process.stdout.write(`${green('已移除')} ${target}\n`);
        process.stdout.write(`${dim(`当前共 ${packages.length} 个工具包`)}\n`);
        return 0;
    }
    if (sub !== 'list') {
        process.stderr.write(`${red('未知子命令')} ${sub}\n用法：qxctf packages [list|add <目录>|remove <目录>]\n`);
        return 1;
    }
    const packages = listPackages();
    const current = flags.config !== null ? resolveConfigDir(flags.config) : readSavedConfigDir();
    if (flags.json) {
        process.stdout.write(`${JSON.stringify({ current, packages }, null, 2)}\n`);
        return 0;
    }
    if (packages.length === 0) {
        process.stdout.write(`${dim('尚未保存任何工具包')}\n`);
        return 0;
    }
    const out = [`${bold('工具包')} ${dim(`共 ${packages.length} 个`)}`];
    for (const record of packages) {
        const summary = packageSummary(record);
        const isCurrent = current !== null && summary.configDir === current;
        const flag = isCurrent ? green(' <- 当前') : '';
        const state = summary.alive ? '' : red(' [路径失效]');
        out.push(`  ${bold(summary.name)} ${dim(summary.version)}${state}${flag}`);
        out.push(`    ${dim(record.path)}`);
    }
    process.stdout.write(`${out.join('\n')}\n`);
    return 0;
}
function configCommand(positionals, flags) {
    const target = positionals[0] ?? flags.config;
    if (target === null || target === undefined) {
        const saved = readSavedConfigDir();
        process.stdout.write(`${dim('当前配置目录')} ${saved ?? red('未配置')}\n`);
        return 0;
    }
    const configDir = resolveConfigDir(target);
    loadBootstrap({ configDir });
    writeSavedConfigDir(configDir);
    addPackage(configDir);
    process.stdout.write(`${green('已切换')} ${configDir}\n`);
    return 0;
}
function initCommand(positionals, flags) {
    const target = positionals[0] ?? '.';
    const result = scaffoldConfig(target, flags.force);
    const out = [`${green('已生成示例工具包')} ${result.packageRoot}`];
    out.push(`${dim('配置目录')} ${result.configDir}`);
    for (const file of result.written) {
        out.push(`  ${green('+')} ${file}`);
    }
    for (const file of result.skipped) {
        out.push(`  ${yellow('=')} ${file} ${dim('(已存在，跳过)')}`);
    }
    process.stdout.write(`${out.join('\n')}\n`);
    try {
        const bootstrap = loadBootstrap({ configDir: result.configDir });
        const items = Object.values(bootstrap.config.menu).reduce((sum, node) => sum + node.items.length, 0);
        process.stdout.write(`${dim(`校验通过：${Object.keys(bootstrap.config.menu).length} 个菜单 / ${items} 个菜单项`)}\n`);
        process.stdout.write(`\n${cyan('下一步')}\n  ${bold(`qxctf config ${result.packageRoot}`)}  ${dim('# 设为当前工具包')}\n  ${bold('qxctf')}  ${dim('# 打开 TUI')}\n`);
        return 0;
    }
    catch (error) {
        process.stderr.write(`${red(`生成的配置未能通过校验：${describeError(error)}`)}\n`);
        return 1;
    }
}
async function tuiCommand(flags) {
    const initial = tryLoadBootstrap({ configDir: flags.config });
    if (initial !== null && flags.config !== null) {
        writeSavedConfigDir(initial.configDir);
        addPackage(initial.configDir);
    }
    const tui = createTui({ initial, loader: createLoader() });
    await tui.run();
    return 0;
}
// ---------- 主流程 ----------
async function main(argv) {
    const { command, positionals, flags } = parseArgs(argv);
    const name = command ?? '';
    if (flags.version) {
        process.stdout.write(`${PRODUCT} ${VERSION}\n`);
        return 0;
    }
    if (flags.help) {
        process.stdout.write(`${usage()}\n`);
        return 0;
    }
    try {
        switch (name) {
            case '':
                if (!process.stdout.isTTY && !flags.tui) {
                    return listCommand(flags);
                }
                return await tuiCommand(flags);
            case 'run':
                return await runCommand(positionals, flags);
            case 'list':
            case 'ls':
                return listCommand(flags);
            case 'path':
                return pathCommand(flags);
            case 'doctor':
            case 'check':
                return doctorCommand(flags);
            case 'packages':
            case 'pkg':
                return packagesCommand(positionals, flags);
            case 'config':
            case 'use':
                return configCommand(positionals, flags);
            case 'init':
                return initCommand(positionals, flags);
            case 'help':
                process.stdout.write(`${usage()}\n`);
                return 0;
            default:
                process.stderr.write(`${red('未知命令')} ${name}\n\n${usage()}\n`);
                return 1;
        }
    }
    catch (error) {
        process.stderr.write(`${red('错误')} ${describeError(error)}\n`);
        return 1;
    }
}
// 只在被当作入口直接运行时执行；被 import 时仅导出函数。
const entry = process.argv[1];
const isEntry = entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href;
if (isEntry) {
    const exitCode = await main(process.argv.slice(2));
    process.exitCode = exitCode;
}
