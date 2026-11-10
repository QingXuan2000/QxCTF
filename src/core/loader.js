/**
 * TUI 与核心层之间的桥
 *
 * App 只依赖这个接口：加载上下文、切换工具包、维护注册表。
 * 需要替换文件系统时，可以传入自己的实现。
 */
import { loadBootstrap } from './bootstrap.js';
import { addPackage, listPackages, removePackage } from './packages.js';
import { resolveConfigDir, writeSavedConfigDir } from './paths.js';
/** 默认实现：直接落到文件系统 */
export function createLoader() {
    return {
        load(configDir) {
            return loadBootstrap({ configDir });
        },
        switchTo(target) {
            const configDir = resolveConfigDir(target);
            const bootstrap = loadBootstrap({ configDir });
            writeSavedConfigDir(configDir);
            addPackage(configDir);
            return { ...bootstrap, packages: listPackages() };
        },
        listPackages() {
            return listPackages();
        },
        addPackage(target) {
            return addPackage(target);
        },
        removePackage(target) {
            return removePackage(target);
        },
    };
}
