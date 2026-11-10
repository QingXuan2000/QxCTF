/**
 * 环境自检
 *
 * `qxctf doctor` 的输出来源。每条检查都独立 try/catch，
 * 一项失败不会掩盖后面的结果——用户一次就能看到全部问题。
 */
import fs from 'node:fs';
import path from 'node:path';
import { archLabel, detectArch, detectOs } from './arch.js';
import { chooseConfigDir } from './bootstrap.js';
import { deriveArchOptions, loadMenuConfig, loadSettings, resolveSettings } from './config.js';
import { describeError } from './errors.js';
import { planExecution } from './executor.js';
import { listPackages } from './packages.js';
import { dataDir, packageRootOf, readSavedConfigDir } from './paths.js';
/** 需要的 Node 主版本 */
const REQUIRED_NODE_MAJOR = 22;
/** 常见可执行 / 脚本扩展名，用于从命令里识别文件参数 */
const PATH_EXTENSION = /\.(exe|com|cmd|bat|ps1|msi|dll|so|dylib|js|mjs|cjs|ts|py|sh|pl|rb|jar|bin|elf)$/i;
/**
 * 从命令行里挑出「像文件路径」的参数，检查它们在 cwd 下是否存在。
 *
 * 判定规则：不以 `-` 开头、不含 `://`，并且要么带路径分隔符，要么带常见
 * 可执行/脚本扩展名。裸命令名（node、nmap）交给 PATH 解析，不做判断。
 * 这样 `node tools/ghost.js` 这种「命令本身存在、脚本不存在」的配置也能被发现。
 */
function missingCommandPaths(command, cwd) {
    const tokens = [];
    const tokenPattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match = tokenPattern.exec(command);
    while (match !== null) {
        const value = match[1] ?? match[2] ?? match[3] ?? '';
        if (value !== '') {
            tokens.push(value);
        }
        match = tokenPattern.exec(command);
    }
    const missing = [];
    for (const token of tokens) {
        if (token.startsWith('-') || token.includes('://')) {
            continue;
        }
        const hasSeparator = token.includes('/') || token.includes('\\');
        if (!hasSeparator && !PATH_EXTENSION.test(token)) {
            continue;
        }
        const candidate = path.isAbsolute(token) ? token : path.resolve(cwd, token);
        let exists = false;
        try {
            exists = fs.existsSync(candidate);
        }
        catch {
            exists = false;
        }
        if (!exists) {
            missing.push(token);
        }
    }
    return missing;
}
/** 收集所有可执行菜单项 */
function executables(config) {
    const rows = [];
    for (const [menuId, node] of Object.entries(config.menu)) {
        for (const item of node.items) {
            if (item.type === 'executable') {
                rows.push({ menuId, id: item.id, name: item.name });
            }
        }
    }
    return rows;
}
/** 执行全部自检 */
export function runDoctor(configDirInput) {
    const checks = [];
    // 1. Node 运行时
    const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
    checks.push({
        name: 'Node 运行时',
        level: major >= REQUIRED_NODE_MAJOR ? 'ok' : 'fail',
        detail: `${process.version}（需要 >= v${REQUIRED_NODE_MAJOR}）`,
    });
    // 2. 数据目录可写
    const dir = dataDir();
    try {
        fs.mkdirSync(dir, { recursive: true });
        const probe = path.join(dir, '.write-probe');
        fs.writeFileSync(probe, 'ok', 'utf8');
        fs.rmSync(probe, { force: true });
        checks.push({ name: '数据目录', level: 'ok', detail: `可写：${dir}` });
    }
    catch (error) {
        checks.push({ name: '数据目录', level: 'fail', detail: `不可写：${dir}（${describeError(error)}）` });
    }
    // 3. 平台与架构
    checks.push({
        name: '平台架构',
        level: 'ok',
        detail: `${detectOs()} / ${archLabel(detectArch())} · node ${process.arch}`,
    });
    // 4. 配置目录
    let configDir = null;
    try {
        configDir = chooseConfigDir(configDirInput);
        checks.push({ name: '配置目录', level: 'ok', detail: configDir });
    }
    catch (error) {
        const saved = readSavedConfigDir();
        checks.push({
            name: '配置目录',
            level: 'fail',
            detail: `未配置（${describeError(error)}）${saved === null ? '' : ` 已保存路径失效：${saved}`}`,
        });
    }
    // 5. 注册表
    const packages = listPackages();
    const missing = packages.filter((entry) => {
        try {
            return !fs.existsSync(entry.path);
        }
        catch {
            return true;
        }
    });
    checks.push({
        name: '工具包注册表',
        level: missing.length === 0 ? 'ok' : 'warn',
        detail: packages.length === 0
            ? '尚未保存任何工具包'
            : `共 ${packages.length} 个${missing.length > 0 ? `，其中 ${missing.length} 个路径已失效` : ''}`,
    });
    if (configDir === null) {
        return { checks, ok: checks.every((check) => check.level !== 'fail') };
    }
    // 之后的检查都基于这个非空值，避免每处都做一次 null 判断
    const activeConfigDir = configDir;
    const packageRoot = packageRootOf(activeConfigDir);
    // 6. menu.json
    let config = null;
    try {
        config = loadMenuConfig(activeConfigDir);
        const total = executables(config).length;
        checks.push({
            name: 'menu.json',
            level: 'ok',
            detail: `${Object.keys(config.menu).length} 个菜单 / ${total} 个可执行项`,
        });
    }
    catch (error) {
        checks.push({ name: 'menu.json', level: 'fail', detail: describeError(error) });
    }
    // 7. settings.json
    try {
        const settings = resolveSettings(loadSettings(activeConfigDir), packageRoot);
        checks.push({
            name: 'settings.json',
            level: 'ok',
            detail: `${settings.appName} ${settings.appVersion} · 架构选择器 ${settings.archPicker ? '开' : '关'}`,
        });
    }
    catch (error) {
        checks.push({ name: 'settings.json', level: 'fail', detail: describeError(error) });
    }
    // 8. 架构选项（从 menu.json 的分发键自动汇总，不再有 arch_picker.json）
    if (config !== null) {
        const options = deriveArchOptions(config.menu);
        checks.push({
            name: '架构选项',
            level: options.length === 0 ? 'warn' : 'ok',
            detail: options.length === 0
                ? '没有按架构分发的命令（path 里没有架构键）'
                : `${options.length} 个：${options.map((option) => option.value).join(' / ')}`,
        });
    }
    // 10. 可执行命令可达性
    if (config !== null) {
        const problems = [];
        for (const row of executables(config)) {
            const node = config.menu[row.menuId];
            const item = node?.items.find((candidate) => candidate.id === row.id);
            if (item === undefined) {
                continue;
            }
            try {
                const plan = planExecution(item, { packageRoot });
                const missing = missingCommandPaths(plan.command, plan.cwd);
                if (missing.length > 0) {
                    problems.push(`${row.menuId}:${row.id} ${row.name} → 找不到 ${missing.join('、')}`);
                }
            }
            catch (error) {
                problems.push(`${row.menuId}:${row.id} ${row.name} → ${describeError(error)}`);
            }
        }
        checks.push({
            name: '命令可达性',
            level: problems.length === 0 ? 'ok' : 'warn',
            detail: problems.length === 0 ? '路径形态检查通过' : problems.join('；'),
        });
    }
    return { checks, ok: checks.every((check) => check.level !== 'fail') };
}
