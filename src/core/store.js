/**
 * 工具箱的持久化状态：收藏与最近使用
 *
 * 数据放在 `$QXCTF_HOME`：
 * - favorites.json  收藏的工具，键为 `工具包根::菜单::编号`
 * - history.json    最近执行记录（最多保留 60 条）
 *
 * 键里带工具包根，所以不同工具包里的同号工具不会互相串。
 */
import fs from 'node:fs';
import path from 'node:path';
import { QxCtfError } from './errors.js';
import { dataDir } from './paths.js';
/** 历史最多保留条数 */
const HISTORY_LIMIT = 60;
/** 输出尾部最多保留行数 */
const TAIL_LIMIT = 40;
function readJson(file) {
    try {
        const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function writeJson(file, value) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    }
    catch (error) {
        throw new QxCtfError(`无法写入 ${file}`, error.message);
    }
}
/** 工具唯一键 */
export function toolKey(packageRoot, menuId, id) {
    return `${path.resolve(packageRoot)}::${menuId}::${id}`;
}
function favoritesFile() {
    return path.join(dataDir(), 'favorites.json');
}
function historyFile() {
    return path.join(dataDir(), 'history.json');
}
/** 读取收藏列表（顺序即用户收藏顺序） */
export function loadFavorites() {
    const raw = readJson(favoritesFile());
    if (raw === null || typeof raw !== 'object') {
        return [];
    }
    const keys = raw.favorites;
    if (!Array.isArray(keys)) {
        return [];
    }
    return keys.filter((key) => typeof key === 'string' && key.trim() !== '');
}
/** 写回收藏列表 */
export function saveFavorites(keys) {
    writeJson(favoritesFile(), { favorites: [...new Set(keys)] });
}
/** 切换收藏状态，返回新列表 */
export function toggleFavorite(key) {
    const current = loadFavorites();
    const next = current.includes(key) ? current.filter((entry) => entry !== key) : [key, ...current];
    saveFavorites(next);
    return next;
}
/** 读取历史（最新在前） */
export function loadHistory() {
    const raw = readJson(historyFile());
    if (raw === null || typeof raw !== 'object') {
        return [];
    }
    const entries = raw.history;
    if (!Array.isArray(entries)) {
        return [];
    }
    const out = [];
    for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null) {
            continue;
        }
        const record = entry;
        if (typeof record.key !== 'string' || typeof record.name !== 'string') {
            continue;
        }
        out.push({
            key: record.key,
            name: record.name,
            command: typeof record.command === 'string' ? record.command : '',
            arch: typeof record.arch === 'string' ? record.arch : 'default',
            code: typeof record.code === 'number' ? record.code : null,
            ms: typeof record.ms === 'number' ? record.ms : 0,
            at: typeof record.at === 'number' ? record.at : 0,
            tail: Array.isArray(record.tail) ? record.tail.filter((line) => typeof line === 'string') : [],
        });
    }
    return out.sort((a, b) => b.at - a.at);
}
/** 追加一条历史，返回新列表 */
export function pushHistory(entry) {
    const list = loadHistory().filter((item) => item.key !== entry.key);
    const next = [{ ...entry, tail: entry.tail.slice(-TAIL_LIMIT) }, ...list].slice(0, HISTORY_LIMIT);
    writeJson(historyFile(), { history: next });
    return next;
}
/** 清空历史 */
export function clearHistory() {
    writeJson(historyFile(), { history: [] });
}
/** 最近使用时间表：工具键 -> 时间戳 */
export function recentMap(entries) {
    const map = new Map();
    for (const entry of entries) {
        if (!map.has(entry.key)) {
            map.set(entry.key, entry.at);
        }
    }
    return map;
}
