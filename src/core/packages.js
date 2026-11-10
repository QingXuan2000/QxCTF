/**
 * 工具包注册表
 *
 * 保存用户用过的工具包路径，供 TUI 里按 p 一键切换。
 * 去重依据是「规范化后的工具包根目录」，所以 `pkg`、`pkg/`、`pkg/config`
 * 三种写法会被识别成同一个包，不会堆出重复项。
 */
import fs from 'node:fs';
import path from 'node:path';
import { readPackageInfo } from './config.js';
import { QxCtfError } from './errors.js';
import { ensureDataDir, packageRootOf, registryFile, resolveConfigDir } from './paths.js';
/** 读取注册表；文件损坏时返回空列表而不是崩掉 */
export function listPackages() {
    const file = registryFile();
    if (!fs.existsSync(file)) {
        return [];
    }
    try {
        const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) {
            return [];
        }
        const packages = parsed.packages;
        if (!Array.isArray(packages)) {
            return [];
        }
        return packages.flatMap((entry) => {
            if (typeof entry !== 'object' || entry === null) {
                return [];
            }
            const record = entry;
            if (typeof record.path !== 'string' || record.path.trim() === '') {
                return [];
            }
            return [
                {
                    path: record.path,
                    name: typeof record.name === 'string' && record.name !== '' ? record.name : path.basename(record.path),
                    ...(typeof record.added === 'string' ? { added: record.added } : {}),
                },
            ];
        });
    }
    catch {
        return [];
    }
}
/** 写回注册表 */
function savePackages(packages) {
    ensureDataDir();
    const payload = JSON.stringify({ packages }, null, 2);
    fs.writeFileSync(registryFile(), `${payload}\n`, 'utf8');
}
/** 工具包根目录的规范化形式，用于去重比较 */
export function canonicalRoot(target) {
    const configDir = resolveConfigDir(target);
    const root = packageRootOf(configDir);
    try {
        return fs.realpathSync.native(root).toLowerCase();
    }
    catch {
        return path.resolve(root).toLowerCase();
    }
}
/**
 * 把工具包加入注册表；同根目录存在时只更新名称。
 * @returns 写入后的完整列表
 */
export function addPackage(target, name) {
    const configDir = resolveConfigDir(target);
    const root = packageRootOf(configDir);
    const key = canonicalRoot(target);
    const info = readPackageInfo(configDir, root);
    const finalName = name !== undefined && name.trim() !== '' ? name.trim() : info.name;
    const packages = listPackages();
    const index = packages.findIndex((entry) => {
        try {
            return canonicalRoot(entry.path) === key;
        }
        catch {
            return false;
        }
    });
    if (index >= 0) {
        const existing = packages[index];
        if (existing !== undefined) {
            packages[index] = { ...existing, name: finalName, path: root };
        }
    }
    else {
        packages.push({ path: root, name: finalName, added: new Date().toISOString() });
    }
    savePackages(packages);
    return packages;
}
/** 从注册表移除；不存在时静默返回当前列表 */
export function removePackage(target) {
    let key;
    try {
        key = canonicalRoot(target);
    }
    catch {
        // 目录可能已被删除，退化为字符串比较
        key = path.resolve(target).toLowerCase();
    }
    const packages = listPackages().filter((entry) => {
        try {
            return canonicalRoot(entry.path) !== key;
        }
        catch {
            return path.resolve(entry.path).toLowerCase() !== key;
        }
    });
    savePackages(packages);
    return packages;
}
/** 校验一个路径能否当作工具包使用，失败时抛 QxCtfError */
/** 注册表条目的展示信息；路径失效时退回记录里的名称 */
export function packageSummary(record) {
    try {
        const configDir = resolveConfigDir(record.path);
        const info = readPackageInfo(configDir, packageRootOf(configDir));
        return { ...info, configDir, alive: true };
    }
    catch {
        return { name: record.name, version: '失效', configDir: record.path, alive: false };
    }
}
