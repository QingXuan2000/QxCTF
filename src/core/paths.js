/**
 * 路径与用户数据目录
 *
 * 用户态数据放在 `$QXCTF_HOME`（默认 `~/.qxctf`）：
 * - config_path.json  当前生效的配置目录
 * - tool_packages.json 已保存的工具包列表
 *
 * 从旧版 Universal Tool Framework / CTF 迁移：首次运行时若新目录不存在而
 * `~/.ctf` 或 `~/.ut-framework` 存在，则整目录复制过来，老用户无需重新配置。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QxCtfError } from './errors.js';
/** 数据目录名 */
const DATA_DIR_NAME = '.qxctf';
/** 旧版数据目录名（按新到旧排列） */
const LEGACY_DIR_NAMES = ['.ctf', '.ut-framework'];
/** 配置文件目录标记 */
const MENU_FILE = 'menu.json';
/** 展开开头的 ~ */
function expandHome(input) {
    const value = input.trim();
    if (value === '~') {
        return os.homedir();
    }
    if (value.startsWith('~/') || value.startsWith('~\\')) {
        return path.join(os.homedir(), value.slice(2));
    }
    return value;
}
/** 用户数据目录，必要时从旧目录迁移 */
export function dataDir() {
    const override = process.env['QXCTF_HOME'] ?? process.env['CTF_HOME'];
    if (override !== undefined && override.trim() !== '') {
        return path.resolve(expandHome(override));
    }
    const primary = path.join(os.homedir(), DATA_DIR_NAME);
    for (const legacyName of LEGACY_DIR_NAMES) {
        const legacy = path.join(os.homedir(), legacyName);
        if (fs.existsSync(primary) || !fs.existsSync(legacy)) {
            continue;
        }
        try {
            fs.cpSync(legacy, primary, { recursive: true });
        }
        catch {
            // 迁移失败不阻塞启动，后续读写会各自报错
        }
    }
    return primary;
}
/** 保存当前配置目录的文件 */
export function configPathFile() {
    return path.join(dataDir(), 'config_path.json');
}
/** 保存工具包列表的文件 */
export function registryFile() {
    return path.join(dataDir(), 'tool_packages.json');
}
/** 确保数据目录存在 */
export function ensureDataDir() {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
/**
 * 把一个用户输入（工具包根目录 / 配置目录 / menu.json 文件）解析成配置目录。
 * 三种输入都接受，避免用户在路径上踩坑。
 */
export function resolveConfigDir(input) {
    const abs = path.resolve(expandHome(input));
    if (fs.existsSync(abs) && fs.statSync(abs).isFile() && path.basename(abs) === MENU_FILE) {
        return path.dirname(abs);
    }
    if (fs.existsSync(path.join(abs, MENU_FILE))) {
        return abs;
    }
    const nested = path.join(abs, 'config');
    if (fs.existsSync(path.join(nested, MENU_FILE))) {
        return nested;
    }
    throw new QxCtfError(`目录 ${abs} 下没有找到 ${MENU_FILE}`, '传入工具包根目录（其 config/menu.json 存在）或直接传入 menu.json 所在目录');
}
/** 配置目录 -> 工具包根目录 */
export function packageRootOf(configDir) {
    return path.dirname(path.resolve(configDir));
}
/** 读取已保存的配置目录；不存在或已失效时返回 null */
export function readSavedConfigDir() {
    const file = configPathFile();
    try {
        const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && 'path' in parsed) {
            const value = parsed.path;
            if (typeof value === 'string' && value.trim() !== '') {
                const dir = path.isAbsolute(value) ? value : path.resolve(value);
                if (fs.existsSync(path.join(dir, MENU_FILE))) {
                    return dir;
                }
            }
        }
    }
    catch {
        // 文件不存在 / 解析失败都视为未配置
    }
    return null;
}
/** 持久化配置目录 */
export function writeSavedConfigDir(configDir) {
    const dir = ensureDataDir();
    const file = path.join(dir, 'config_path.json');
    const payload = JSON.stringify({ path: path.resolve(configDir) }, null, 2);
    fs.writeFileSync(file, `${payload}\n`, 'utf8');
}
