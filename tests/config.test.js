import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { deriveArchOptions, loadMenuConfig, loadSettings, readPackageInfo, resolveSettings, } from '../src/core/config.js';
import { QxCtfError } from '../src/core/errors.js';
import { makePackage, minimalMenu, tempDir, writeJson, writeText } from './helpers/fixtures.js';
describe('menu.json 校验', () => {
    it('缺失文件时报错并提示 init', () => {
        const dir = tempDir();
        assert.throws(() => loadMenuConfig(path.join(dir, 'config')), (error) => error instanceof QxCtfError && /配置文件不存在/.test(error.message));
    });
    it('非法 JSON 报解析错误', () => {
        const dir = tempDir();
        writeText(path.join(dir, 'config', 'menu.json'), '{ oops');
        assert.throws(() => loadMenuConfig(path.join(dir, 'config')), /JSON 解析失败/);
    });
    it('BOM 开头也能解析', () => {
        const dir = tempDir();
        writeText(path.join(dir, 'config', 'menu.json'), `\uFEFF${JSON.stringify(minimalMenu)}`);
        const config = loadMenuConfig(path.join(dir, 'config'));
        assert.equal(config.menu['main']?.title, '测试菜单');
    });
    it('缺少 main 菜单被拒绝', () => {
        const dir = tempDir();
        makePackage(dir, { menu: { menu: { other: { title: 'x', items: [] } } } });
        assert.throws(() => loadMenuConfig(path.join(dir, 'config')), /缺少 main 菜单/);
    });
    it('重复 id 被拒绝', () => {
        const dir = tempDir();
        makePackage(dir, {
            menu: {
                menu: {
                    main: {
                        title: '',
                        items: [
                            { id: 1, name: 'a', type: 'back' },
                            { id: 1, name: 'b', type: 'back' },
                        ],
                    },
                },
            },
        });
        assert.throws(() => loadMenuConfig(path.join(dir, 'config')), /id=1 重复/);
    });
    it('分区写法摊平成条目并带 section 标记', () => {
        const dir = tempDir();
        makePackage(dir, {
            menu: {
                menu: {
                    main: {
                        title: '分组菜单',
                        items: [
                            { 常用: [{ id: 1, name: 'a', path: 'node -v' }] },
                            {
                                进阶: [
                                    { id: 2, name: 'b', path: 'node -v' },
                                    { id: 3, name: 'c', submenu: 'sub' },
                                ],
                            },
                            { id: 4, name: '无分区', path: 'node -v' },
                        ],
                    },
                    sub: { title: '子', parent: 'main', items: [] },
                },
            },
        });
        const config = loadMenuConfig(path.join(dir, 'config'));
        const items = config.menu['main'].items;
        assert.deepEqual(items.map((item) => item.id), [1, 2, 3, 4]);
        assert.deepEqual(items.map((item) => item.section ?? ''), ['常用', '进阶', '进阶', '']);
        assert.equal(items[2].type, 'submenu');
    });
    it('分区内容不是数组时报出精确路径', () => {
        const dir = tempDir();
        makePackage(dir, {
            menu: { menu: { main: { title: '', items: [{ 常用: 'not-an-array' }] } } },
        });
        assert.throws(() => loadMenuConfig(path.join(dir, 'config')), /items\.0\.常用: 分区内容必须是数组/);
    });
    it('分区里的条目字段错误也带完整路径', () => {
        const dir = tempDir();
        makePackage(dir, {
            menu: { menu: { main: { title: '', items: [{ 常用: [{ id: 1, name: 'a', detail: 42 }] }] } } },
        });
        assert.throws(() => loadMenuConfig(path.join(dir, 'config')), /menu\.main\.items\.0\.常用\.0\.detail/);
    });
    it('子菜单引用不存在被拒绝', () => {
        const dir = tempDir();
        makePackage(dir, {
            menu: { menu: { main: { title: '', items: [{ id: 1, name: 'a', type: 'submenu', submenu: 'ghost' }] } } },
        });
        assert.throws(() => loadMenuConfig(path.join(dir, 'config')), /指向不存在的子菜单 ghost/);
    });
    it('可执行项缺少 path 被拒绝', () => {
        const dir = tempDir();
        makePackage(dir, { menu: { menu: { main: { title: '', items: [{ id: 1, name: 'a', type: 'executable' }] } } } });
        assert.throws(() => loadMenuConfig(path.join(dir, 'config')), /path 为空/);
    });
    it('省略 type 时按字段推断', () => {
        const dir = tempDir();
        makePackage(dir, {
            menu: {
                menu: {
                    main: {
                        title: '',
                        items: [
                            { id: 1, name: '有子菜单', submenu: 'sub' },
                            { id: 2, name: '有路径', path: 'echo hi' },
                        ],
                    },
                    sub: { title: '', parent: 'main', items: [] },
                },
            },
        });
        const config = loadMenuConfig(path.join(dir, 'config'));
        assert.equal(config.menu['main']?.items[0]?.type, 'submenu');
        assert.equal(config.menu['main']?.items[1]?.type, 'executable');
    });
    it('字段类型错误给出行列定位', () => {
        const dir = tempDir();
        writeJson(path.join(dir, 'config', 'menu.json'), {
            menu: { main: { title: 'x', items: [{ id: 'not-a-number', name: 'a' }] } },
        });
        assert.throws(() => loadMenuConfig(path.join(dir, 'config')), /menu\.main\.items\.0\.id/);
    });
    it('detail 支持字符串与字符串数组', () => {
        const dir = tempDir();
        makePackage(dir, {
            menu: {
                menu: {
                    main: {
                        title: '',
                        items: [
                            { id: 1, name: '单行', type: 'main', detail: '一行描述' },
                            { id: 2, name: '多行', type: 'main', detail: ['第一行', '第二行'] },
                        ],
                    },
                },
            },
        });
        const config = loadMenuConfig(path.join(dir, 'config'));
        assert.equal(config.menu['main']?.items[0]?.detail, '一行描述');
        assert.deepEqual(config.menu['main']?.items[1]?.detail, ['第一行', '第二行']);
    });
    it('detail 类型错误被拒绝', () => {
        const dir = tempDir();
        writeJson(path.join(dir, 'config', 'menu.json'), {
            menu: { main: { title: 'x', items: [{ id: 1, name: 'a', type: 'main', detail: 42 }] } },
        });
        assert.throws(() => loadMenuConfig(path.join(dir, 'config')), /detail/);
    });
});
describe('settings.json', () => {
    it('缺失时返回空对象', () => {
        const dir = tempDir();
        assert.deepEqual(loadSettings(path.join(dir, 'config')), {});
    });
    it('扁平写法：name / version / theme / color / archPicker', () => {
        const dir = tempDir();
        const configDir = makePackage(dir, {
            menu: minimalMenu,
            settings: { name: 'pack', version: '2.0.0', archPicker: true, theme: 'light', color: '256' },
        });
        const resolved = resolveSettings(loadSettings(configDir), path.dirname(configDir));
        assert.equal(resolved.appName, 'pack');
        assert.equal(resolved.appVersion, '2.0.0');
        assert.equal(resolved.archPicker, true);
        assert.equal(resolved.themeName, 'light');
        assert.equal(resolved.colorMode, '256');
    });
    it('兼容旧版嵌套写法（app / settings）', () => {
        const dir = tempDir();
        const configDir = makePackage(dir, {
            menu: minimalMenu,
            settings: {
                app: { name: 'old', version: '0.9.0' },
                settings: { arch_picker: true, ui_theme: 'light', color_mode: '16', display_clear: true, input_method: 'num_input' },
            },
        });
        // 已删除的 logo / display_clear / input_method 字段被静默忽略
        const resolved = resolveSettings(loadSettings(configDir), path.dirname(configDir));
        assert.equal(resolved.appName, 'old');
        assert.equal(resolved.appVersion, '0.9.0');
        assert.equal(resolved.archPicker, true);
        assert.equal(resolved.themeName, 'light');
        assert.equal(resolved.colorMode, '16');
    });
    it('旧配置里的 logo 字段被忽略，不影响解析', () => {
        const dir = tempDir();
        const configDir = makePackage(dir, {
            menu: minimalMenu,
            settings: { name: 'pack', logo: { display_logo: true, logo_path: './logo' } },
        });
        const resolved = resolveSettings(loadSettings(configDir), path.dirname(configDir));
        assert.equal(resolved.appName, 'pack');
        assert.deepEqual(Object.keys(resolved).sort(), ['appName', 'appVersion', 'archPicker', 'colorMode', 'colors', 'themeName']);
        // 没配自定义配色时两个主题都是空对象（渲染层走内置配色）
        assert.deepEqual(resolved.colors, { dark: {}, light: {} });
    });
    it('自定义配色按主题分别读取', () => {
        const dir = tempDir();
        const configDir = makePackage(dir, {
            menu: minimalMenu,
            settings: {
                name: 'pack',
                colors: { dark: { accent: '#ff8800' }, light: { title: '#0055ff', base: '#fafafa' } },
            },
        });
        const resolved = resolveSettings(loadSettings(configDir), path.dirname(configDir));
        assert.deepEqual(resolved.colors.dark, { accent: '#ff8800' });
        assert.deepEqual(resolved.colors.light, { title: '#0055ff', base: '#fafafa' });
    });
    it('工具包信息在缺省时退回目录名', () => {
        const dir = tempDir();
        const configDir = makePackage(dir, { menu: minimalMenu });
        const info = readPackageInfo(configDir, path.dirname(configDir));
        assert.equal(info.name, path.basename(dir));
        assert.equal(info.version, '未知版本');
    });
});
describe('架构选项（从 menu.json 汇总）', () => {
    it('没有按架构分发的命令时为空', () => {
        assert.deepEqual(deriveArchOptions(minimalMenu.menu), []);
    });
    it('汇总 path 映射里的键，按固定顺序排列', () => {
        const menu = {
            main: {
                title: 'x',
                items: [
                    { id: 1, name: 'arm', type: 'executable', path: { ARM64: 'a', ARM32: 'b' } },
                    { id: 2, name: 'x86', type: 'executable', path: { X86: 'c', X86_64: 'd' } },
                    { id: 3, name: 'plain', type: 'executable', path: 'echo hi' },
                ],
            },
        };
        assert.deepEqual(deriveArchOptions(menu).map((option) => option.value), ['X86_64', 'X86', 'ARM64', 'ARM32']);
        assert.deepEqual(deriveArchOptions(menu)[0], { display: 'X86_64', value: 'X86_64' });
    });
    it('未知键排在已知键之后并按字母序', () => {
        const menu = {
            main: {
                title: 'x',
                items: [{ id: 1, name: 'm', type: 'executable', path: { RISCV: 'a', X86_64: 'b', LOONG: 'c' } }],
            },
        };
        assert.deepEqual(deriveArchOptions(menu).map((option) => option.value), ['X86_64', 'LOONG', 'RISCV']);
    });
});
