/**
 * 启动上下文装配
 *
 * 把散落在磁盘上的配置读成一份 AppBootstrap，TUI 与 CLI 共用。
 * 这里是唯一允许「配置目录从哪来」的逻辑落点：显式参数 > 已保存路径 > 报错。
 */
import { detectArch, detectOs } from './arch.js';
import { deriveArchOptions, loadMenuConfig, loadSettings, readPackageInfo, resolveSettings, } from './config.js';
import { QxCtfError } from './errors.js';
import { resolveTarget } from './menu.js';
import { listPackages } from './packages.js';
import { packageRootOf, readSavedConfigDir, resolveConfigDir } from './paths.js';
/** 决定使用哪个配置目录 */
export function chooseConfigDir(explicit) {
    if (explicit !== undefined && explicit !== null && explicit.trim() !== '') {
        return resolveConfigDir(explicit);
    }
    const saved = readSavedConfigDir();
    if (saved !== null) {
        return saved;
    }
    throw new QxCtfError('尚未配置工具包路径', '运行 `qxctf init <目录>` 生成示例包，或用 `qxctf config <目录>` 指定现有工具包');
}
/** 装配启动上下文；配置不可用时抛 QxCtfError */
export function loadBootstrap(options = {}) {
    const configDir = chooseConfigDir(options.configDir);
    const packageRoot = packageRootOf(configDir);
    const config = loadMenuConfig(configDir);
    const rawSettings = loadSettings(configDir);
    const settings = resolveSettings(rawSettings, packageRoot);
    const packageInfo = readPackageInfo(configDir, packageRoot);
    return {
        configDir,
        packageRoot,
        packageInfo,
        config,
        settings,
        archOptions: deriveArchOptions(config.menu),
        packages: listPackages(),
        arch: detectArch(),
        os: detectOs(),
        node: process.version,
    };
}
/** 装配启动上下文；未配置或配置损坏时返回 null（TUI 首启动流程用） */
export function tryLoadBootstrap(options = {}) {
    try {
        return loadBootstrap(options);
    }
    catch {
        return null;
    }
}
/** 取一个工具包里的第一个可执行菜单项，供 init 后的自检使用 */
/** 校验某个目标表达式在给定上下文里能否解析（预检用） */
