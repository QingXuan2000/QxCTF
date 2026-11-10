/**
 * 测试夹具：临时目录、示例工具包定位、最小 config 生成
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/** 从当前文件向上找到仓库根（package.json 含本项目的 name 字段） */
function findRepoRoot() {
    let dir = path.resolve(import.meta.dirname);
    for (let depth = 0; depth < 6; depth += 1) {
        const candidate = path.join(dir, 'package.json');
        if (fs.existsSync(candidate)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
                if (pkg.name === '@qingxuan2000/qxctf') {
                    return dir;
                }
            }
            catch {
                // 继续向上找
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    // 兜底：测试源码位置 -> 仓库根
    return path.resolve(import.meta.dirname, '..', '..');
}
/** 仓库根目录 */
export const repoRoot = findRepoRoot();
/** 仓库内示例工具包（由 `qxctf init examples/demo` 生成） */
export const demoPackage = path.join(repoRoot, 'examples', 'demo');
/** 假工具集：覆盖 args / 架构映射 / cwd / 退出码 / 三级菜单 / 缺失工具 */
export const fakePackage = path.join(repoRoot, 'examples', 'fake-tools');
/** 创建一个测试用临时目录 */
export function tempDir(prefix = 'qxctf-test-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
/** 写一个 JSON 文件，自动建目录 */
export function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
/** 写文本文件，自动建目录 */
export function writeText(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, 'utf8');
}
/** 在 dir 下生成一个工具包，返回配置目录 */
export function makePackage(dir, options) {
    const configDir = path.join(dir, 'config');
    writeJson(path.join(configDir, 'menu.json'), options.menu);
    if (options.settings !== undefined) {
        writeJson(path.join(configDir, 'settings.json'), options.settings);
    }
    if (options.archPicker !== undefined) {
        writeJson(path.join(configDir, 'arch_picker.json'), options.archPicker);
    }
    if (options.logo !== undefined) {
        writeText(path.join(configDir, 'logo'), options.logo);
    }
    return configDir;
}
/** 最小可用菜单 */
export const minimalMenu = {
    menu: {
        main: {
            title: '测试菜单',
            items: [
                { id: 1, name: '子菜单', type: 'submenu', submenu: 'sub' },
                { id: 2, name: '工具', type: 'executable', path: 'node --version' },
            ],
        },
        sub: {
            title: '子',
            parent: 'main',
            items: [{ id: 1, name: '返回', type: 'back' }],
        },
    },
};
