/**
 * TUI 行为测试（零依赖渲染层）
 *
 * 直接构造 QxCtfTui：snapshot() 取纯文本帧，handleKeypress / handleMouse 驱动交互。
 * 覆盖工具箱语义：数字选号、即时过滤、收藏、最近使用、执行与输出抽屉、鼠标。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { loadBootstrap } from '../src/core/bootstrap.js';
import { planExecution } from '../src/core/executor.js';
import { createLoader } from '../src/core/loader.js';
import { listPackages } from '../src/core/packages.js';
import { readSavedConfigDir } from '../src/core/paths.js';
import { clearHistory, saveFavorites } from '../src/core/store.js';
import { CLEAR_SCREEN, QxCtfTui, runHandoffEnd, runHandoffStart } from '../src/tui/app.js';
import { FAVORITES_VIEW, RECENT_VIEW, SETTINGS_TOTAL, SIDEBAR_ENTRIES } from '../src/tui/model.js';
import { strWidth } from '../src/ui/width.js';
import { demoPackage, fakePackage, makePackage, minimalMenu, tempDir } from './helpers/fixtures.js';
import { fakeExecutor, findColumn, findRow, keys, makeTui } from './helpers/tui.js';
let demo;
let fake;
before(() => {
    process.env['QXCTF_HOME'] = tempDir('qxctf-home-');
    demo = loadBootstrap({ configDir: demoPackage });
    fake = loadBootstrap({ configDir: fakePackage });
});
beforeEach(() => {
    // 每个用例从干净的收藏 / 历史开始
    saveFavorites([]);
    clearHistory();
});
describe('TUI · 渲染', () => {
    it('一帧里包含顶栏、面包屑、选项详情、侧栏、工具行与底栏计数', () => {
        const view = makeTui(demo);
        const text = view.text();
        // 顶栏左侧是主菜单 title + 版本
        assert.match(view.lines()[0] ?? '', /QxCTF 工具箱 1\.0\.0/);
        assert.doesNotMatch(view.lines()[0] ?? '', /v3\.0\.0/);
        assert.match(text, /信息收集/);
        assert.match(text, /环境自检/);
        // 面包屑第一段固定是「根目录」
        assert.match(text, /根目录/);
        // 第 1 项是子菜单，详情显示进入动作
        assert.match(text, /进入「信息收集」菜单/);
        assert.match(text, /1\/4/);
        // 内容区底部不再有命令条
        assert.doesNotMatch(text, /\$ /);
        view.tui.index = 1;
        // 命令通过详情呈现
        assert.match(view.text(), /确认工具链可用：node --version/);
    });
    it('列表里不再出现 back / main 导航项', () => {
        const view = makeTui(demo);
        assert.ok(view.tui.rows.every((row) => row.item.type === 'executable' || row.item.type === 'submenu'));
        assert.doesNotMatch(view.text(), /返回上级|返回主菜单|退出框架/);
    });
    it('默认示例包不再使用分区', () => {
        const view = makeTui(demo, { size: { columns: 100, rows: 26 } });
        assert.ok(view.tui.rows.every((row) => row.item.section === undefined));
        assert.doesNotMatch(view.text(), /常用 ───|进阶 ───/);
    });
    it('配置里写了分区时，列表单独成行且不参与选择', () => {
        const dir = tempDir();
        const configDir = makePackage(dir, {
            menu: {
                menu: {
                    main: {
                        title: '分组菜单',
                        items: [
                            { 常用: [{ id: 1, name: '甲', path: 'node -v' }] },
                            { 进阶: [{ id: 2, name: '乙', path: 'node -v' }] },
                        ],
                    },
                },
            },
        });
        const view = makeTui(loadBootstrap({ configDir }), { size: { columns: 100, rows: 26 } });
        const text = view.text();
        assert.match(text, /常用 ───/);
        assert.match(text, /进阶 ───/);
        // 选择仍按条目走
        assert.equal(view.tui.index, 0);
        assert.equal(view.tui.rows[0].item.name, '甲');
        assert.equal(view.tui.rows[0].item.section, '常用');
        const headerRow = findRow(view.lines(), '常用 ───');
        assert.ok(headerRow >= 0);
        assert.doesNotMatch(view.lines()[headerRow] ?? '', /▌|^\s*\d+\s{2}/);
    });
    it('线框使用直角，三块面板各自成框', () => {
        const view = makeTui(demo, { size: { columns: 100, rows: 24 } });
        const text = view.text();
        assert.match(text, /┌─ 路径 /);
        assert.match(text, /┌─ 详情 /);
        assert.match(text, /┌─ 工具 /);
        assert.match(text, /┘/);
        assert.doesNotMatch(text, /[╭╮╰╯]/);
    });
    it('帧尺寸与终端一致', () => {
        const view = makeTui(demo, { size: { columns: 100, rows: 24 } });
        const lines = view.lines();
        assert.equal(lines.length, 24);
        for (const line of lines) {
            assert.ok(line.length <= 100, `行超宽：${line.length}`);
        }
    });
    it('窄终端仍可渲染', () => {
        const view = makeTui(demo, { size: { columns: 70, rows: 16 } });
        const lines = view.lines();
        assert.equal(lines.length, 16);
        assert.match(lines.join('\n'), /QxCTF/);
    });
    it('未配置时进入首次运行输入框', () => {
        const view = makeTui(null);
        assert.equal(view.tui.modal?.kind, 'input');
        assert.match(view.text(), /首次运行/);
    });
    it('首次启动输入的工具包会被登记，p 面板里能看到', async () => {
        // 用真实 loader：会写 config_path.json 与 tool_packages.json
        process.env['QXCTF_HOME'] = tempDir('qxctf-first-run-');
        const view = makeTui(null, { loader: createLoader() });
        assert.equal(view.tui.modal?.kind, 'input');
        await view.type(demoPackage);
        await view.key('\r', keys.enter);
        assert.ok(view.tui.bootstrap !== null, '输入有效目录后应完成配置');
        assert.equal(view.tui.menuId, 'main');
        // 持久化：当前配置目录
        assert.equal(readSavedConfigDir(), path.join(demoPackage, 'config'));
        // 注册表：工具包已加入
        const registered = listPackages().map((record) => path.resolve(record.path));
        assert.ok(registered.includes(path.resolve(demoPackage)), `注册表里没有该工具包：${registered.join(', ')}`);
        assert.ok(view.tui.bootstrap.packages.some((record) => path.resolve(record.path) === path.resolve(demoPackage)));
        // p 面板能看到它
        await view.key('p');
        assert.equal(view.tui.modal?.kind, 'packages');
        assert.match(view.text(), /qxctf-demo/);
    });
    it('侧栏列出菜单树与两个虚拟视图', () => {
        const view = makeTui(fake);
        const text = view.text();
        assert.match(text, /假工具集 \/ Fake Toolchain/);
        assert.match(text, /收藏/);
        assert.match(text, /最近使用/);
    });
    it('左栏只有视图 / 工具包两块面板，没有菜单树', () => {
        const view = makeTui(fake, { size: { columns: 104, rows: 26 } });
        const text = view.text();
        assert.match(text, /┌─ 视图 /);
        assert.match(text, /┌─ 工具包 /);
        assert.doesNotMatch(text, /┌─ 菜单 /);
        // 左栏不再列菜单：侧栏列区里不应出现菜单名或层级符号
        const sidebar = view.lines().map((line) => line.slice(0, 21)).join('\n');
        assert.doesNotMatch(sidebar, /信息收集|第三层|Fake Toolchain/);
        assert.doesNotMatch(sidebar, /└ /);
        // 顶栏右侧是统计与平台胶囊
        assert.match(text, /\d+ 工具\s+★ \d+/);
        assert.match(text, /X86_64|ARM64|X86|ARM32/);
    });
    it('顶栏左侧是主菜单 title + 版本，不塞框架版本与长路径', () => {
        const view = makeTui(fake, { size: { columns: 104, rows: 26 } });
        const firstRow = view.lines()[0] ?? '';
        assert.match(firstRow, /假工具集 \/ Fake Toolchain 0\.1\.0/);
        assert.doesNotMatch(firstRow, /v3\.0\.0/);
        assert.doesNotMatch(firstRow, /QxCTF v3/);
        assert.doesNotMatch(firstRow, /Documents/);
        // 右侧仍是计数与平台胶囊
        assert.match(firstRow, /\d+ 工具/);
    });
    it('矮终端侧栏退化为无框列表，仍保留统计信息', () => {
        const view = makeTui(fake, { size: { columns: 104, rows: 16 } });
        const text = view.text();
        assert.doesNotMatch(text, /┌─ 视图 /);
        assert.match(text, /\d+ 工具 · ★\d+/);
        assert.match(text, /fake-tools/);
    });
    it('点侧栏的工具包面板会打开工具包弹层', async () => {
        const view = makeTui(fake, { size: { columns: 104, rows: 26 } });
        const lines = view.lines();
        const row = findRow(lines, '┌─ 工具包 ');
        assert.ok(row >= 0);
        await view.click(4, row + 1);
        assert.equal(view.tui.modal?.kind, 'packages');
    });
});
describe('TUI · 键盘', () => {
    it('↑↓ / j k 移动，到边界不越界', async () => {
        const view = makeTui(demo);
        await view.key('', keys.down);
        assert.equal(view.tui.index, 1);
        await view.key('j');
        assert.equal(view.tui.index, 2);
        await view.key('k');
        assert.equal(view.tui.index, 1);
        await view.key('', keys.up);
        assert.equal(view.tui.index, 0);
        await view.key('', keys.up);
        assert.equal(view.tui.index, 0);
    });
    it('数字键选中同编号的工具（工具箱语义）', async () => {
        const view = makeTui(fake);
        await view.key('4');
        assert.equal(view.tui.rows[view.tui.index]?.item.id, 4);
        // 菜单不变
        assert.equal(view.tui.menuId, 'main');
    });
    it('Enter 进入子菜单，b 返回，m 回主菜单', async () => {
        const view = makeTui(demo);
        await view.key('', keys.enter); // 第 1 项是子菜单
        assert.equal(view.tui.menuId, 'recon');
        assert.match(view.text(), /示例：系统信息/);
        await view.key('b');
        assert.equal(view.tui.menuId, 'main');
        await view.key('', keys.enter);
        await view.key('m');
        assert.equal(view.tui.menuId, 'main');
        assert.deepEqual(view.tui.stack, ['main']);
    });
    it('Esc 返回上级：先清过滤，再返回', async () => {
        const view = makeTui(fake);
        view.tui.setMenu('recon-deep');
        assert.equal(view.tui.menuId, 'recon-deep');
        // 无过滤时直接返回上级
        await view.key('', keys.escape);
        assert.equal(view.tui.menuId, 'recon');
        // 有过滤时第一次只清过滤，菜单不动
        await view.key('/');
        await view.type('深');
        assert.equal(view.tui.filter, '深');
        await view.key('', keys.escape);
        assert.equal(view.tui.filter, '');
        assert.equal(view.tui.menuId, 'recon');
        // 第二次才返回
        await view.key('', keys.escape);
        assert.equal(view.tui.menuId, 'main');
        // 顶端再按 Esc 停在主菜单
        await view.key('', keys.escape);
        assert.equal(view.tui.menuId, 'main');
    });
    it('底栏常驻 Esc 返回提示', () => {
        const view = makeTui(demo, { size: { columns: 100, rows: 22 } });
        assert.match(view.lines().at(-1) ?? '', /Esc 返回/);
    });
    it('Tab 在视图间循环，Shift+Tab 反向', async () => {
        const view = makeTui(demo);
        await view.key('', { name: 'tab' });
        assert.equal(view.tui.menuId, '__favorites');
        await view.key('', { name: 'tab' });
        assert.equal(view.tui.menuId, '__recent');
        await view.key('', { name: 'tab' });
        assert.equal(view.tui.menuId, '__settings');
        await view.key('', { name: 'tab' });
        assert.equal(view.tui.menuId, 'main');
        await view.key('', { name: 'tab', shift: true });
        assert.equal(view.tui.menuId, '__settings');
    });
    it('收藏 / 最近使用视图不显示分区标题', () => {
        const dir = tempDir();
        const configDir = makePackage(dir, {
            menu: {
                menu: {
                    main: {
                        title: '分组菜单',
                        items: [
                            { 常用: [{ id: 1, name: '甲', path: 'node -v' }] },
                            { 进阶: [{ id: 2, name: '乙', path: 'node -v' }] },
                        ],
                    },
                },
            },
        });
        const view = makeTui(loadBootstrap({ configDir }), { size: { columns: 100, rows: 24 } });
        view.tui.setMenu('__recent');
        assert.doesNotMatch(view.text(), /常用 ───|进阶 ───/);
        view.tui.setMenu('__favorites');
        assert.doesNotMatch(view.text(), /常用 ───|进阶 ───/);
        // 真正的菜单里仍然分组
        view.tui.setMenu('main');
        assert.match(view.text(), /常用 ───/);
    });
    it('/ 即时过滤：输入即生效，Esc 清空', async () => {
        const view = makeTui(fake);
        await view.key('/');
        assert.equal(view.tui.filtering, true);
        await view.type('慢');
        assert.equal(view.tui.filter, '慢');
        assert.equal(view.tui.rows.length, 1);
        assert.equal(view.tui.rows[0]?.item.name, '慢工具');
        assert.match(view.text(), /过滤: 慢/);
        await view.key('', keys.escape);
        assert.equal(view.tui.filter, '');
        assert.equal(view.tui.filtering, false);
        assert.equal(view.tui.rows.length, view.tui.totalRows);
    });
    it('PgDn / End 跳转与 Home 回顶', async () => {
        const view = makeTui(fake);
        await view.key('', keys.pageDown);
        assert.ok(view.tui.index > 0);
        await view.key('', { name: 'end' });
        assert.equal(view.tui.index, view.tui.rows.length - 1);
        await view.key('', { name: 'home' });
        assert.equal(view.tui.index, 0);
    });
});
describe('TUI · 收藏与最近使用', () => {
    it('f 收藏后星标出现，并进入收藏视图', async () => {
        const view = makeTui(fake);
        await view.key('4'); // 失败退出
        await view.key('f');
        assert.equal(view.tui.favoriteCount, 1);
        assert.match(view.text(), /★/);
        view.tui.setMenu(FAVORITES_VIEW);
        assert.equal(view.tui.menuId, FAVORITES_VIEW);
        assert.equal(view.tui.rows.length, 1);
        assert.equal(view.tui.rows[0]?.item.name, '失败退出');
        assert.match(view.text(), /收藏/);
    });
    it('再按一次 f 取消收藏', async () => {
        const view = makeTui(fake);
        await view.key('4');
        await view.key('f');
        assert.equal(view.tui.favoriteCount, 1);
        await view.key('f');
        assert.equal(view.tui.favoriteCount, 0);
    });
    it('收藏视图为空时给出提示', async () => {
        const view = makeTui(fake);
        view.tui.setMenu(FAVORITES_VIEW);
        assert.match(view.text(), /还没有收藏/);
    });
    it('执行后出现在最近使用视图，并显示相对时间', async () => {
        const { executor } = fakeExecutor(0);
        const view = makeTui(fake, { execute: executor });
        view.tui.setMenu('recon');
        view.tui.index = view.tui.rows.findIndex((row) => row.item.name === '环境变量摘要');
        await view.key('\r', keys.enter); // 架构面板（fake-tools 开了 arch_picker）
        await view.key('\r', keys.enter); // 选默认架构 → 执行
        await view.idle();
        view.tui.setMenu(RECENT_VIEW);
        assert.equal(view.tui.rows.length, 1);
        assert.equal(view.tui.rows[0]?.item.name, '环境变量摘要');
        assert.match(view.text(), /最近使用/);
    });
});
describe('TUI · 选项详情', () => {
    it('渲染配置里的 detail（数组形式）', () => {
        const view = makeTui(demo);
        view.tui.index = 1; // 环境自检
        const text = view.text();
        assert.match(text, /确认工具链可用：node --version/);
        assert.match(text, /工作目录：/);
    });
    it('占位符 {command} / {arch} 会被替换', () => {
        const view = makeTui(demo);
        view.tui.index = 2; // 运行时信息（按架构分发）
        const text = view.text();
        assert.match(text, new RegExp(`当前命中架构：${demo.arch}`));
        assert.match(text, /命令：node -e/);
        assert.doesNotMatch(text, /\{(command|cwd|arch|name|id|menu|type|desc)\}/);
    });
    it('切换选项时详情同步变化', () => {
        const view = makeTui(demo);
        assert.match(view.text(), /进入「信息收集」菜单/);
        view.tui.index = 1;
        assert.match(view.text(), /确认工具链可用/);
    });
    it('单行字符串形式的 detail 也能显示', () => {
        const view = makeTui(fake);
        // fake-tools 的 main:1 用单行字符串写 detail
        assert.match(view.text(), /调用 node tools\/hello\.js/);
    });
    it('未配置 detail 时回退为自动摘要', () => {
        const view = makeTui(fake);
        const index = view.tui.rows.findIndex((row) => row.item.name === '相对 cwd');
        assert.ok(index >= 0);
        view.tui.index = index;
        // 兜底显示执行目录
        assert.match(view.text(), /目录\s+\S.*tools/);
    });
    it('详情行数随终端高度伸缩', () => {
        // 高终端：h=27 → 3 行额度，能放下两条详情
        const tall = makeTui(demo, { size: { columns: 100, rows: 30 } });
        tall.tui.index = 1;
        assert.match(tall.text(), /工作目录：/);
        // 矮终端：h=15 → 1 行额度，只显示第一条
        const short = makeTui(demo, { size: { columns: 100, rows: 18 } });
        short.tui.index = 1;
        assert.match(short.text(), /确认工具链可用/);
        assert.doesNotMatch(short.text(), /工作目录：/);
    });
});
describe('TUI · 执行时的终端接管', () => {
    const envCheck = () => {
        const item = demo.config.menu['main']?.items.find((candidate) => candidate.name === '环境自检');
        assert.ok(item !== undefined);
        return { item, plan: planExecution(item, { packageRoot: demo.packageRoot }) };
    };
    it('运行前先清屏，再打印横幅与解析后的命令', () => {
        const { item, plan } = envCheck();
        const text = runHandoffStart(item, plan);
        assert.ok(text.startsWith(CLEAR_SCREEN), '首字节必须是清屏序列');
        assert.equal(CLEAR_SCREEN, '\x1b[2J\x1b[H');
        assert.match(text, /\[QxCTF\] 环境自检/);
        assert.match(text, /node --version/);
        // 清屏后立即打印横幅，不要在顶部先留空行
        assert.ok(text.startsWith(`${CLEAR_SCREEN}[QxCTF]`), '清屏后应直接从第 1 行开始打印');
    });
    it('结束后打印退出码与返回提示', () => {
        assert.match(runHandoffEnd(0), /退出码 0 · 按任意键返回/);
        assert.match(runHandoffEnd(7), /退出码 7/);
        assert.match(runHandoffEnd(null), /退出码 -/);
    });
});
describe('TUI · 面包屑导航', () => {
    it('主菜单只有一段「根目录」，进入子菜单后变成两段', async () => {
        const view = makeTui(demo);
        assert.doesNotMatch(view.text(), /›/);
        assert.match(view.text(), /根目录/);
        await view.key('', keys.enter); // 进入「信息收集」
        assert.equal(view.tui.menuId, 'recon');
        assert.match(view.text(), /根目录 › 信息收集/);
    });
    it('点击面包屑的「根目录」回到主菜单', async () => {
        const view = makeTui(demo);
        await view.key('', keys.enter);
        assert.equal(view.tui.menuId, 'recon');
        const lines = view.lines();
        const crumbRow = findRow(lines, '›');
        assert.ok(crumbRow >= 0);
        const column = findColumn(lines, crumbRow, '根目录');
        assert.ok(column >= 0);
        await view.click(column, crumbRow);
        assert.equal(view.tui.menuId, 'main');
    });
    it('三级菜单的面包屑包含全部层级', async () => {
        const view = makeTui(fake);
        view.tui.setMenu('recon-deep');
        assert.match(view.text(), /根目录 › 信息收集 › 第三层/);
    });
    it('b / ← / m / → 仍可用于返回与回主菜单', async () => {
        const view = makeTui(fake);
        view.tui.setMenu('recon-deep');
        await view.key('', keys.left);
        assert.equal(view.tui.menuId, 'recon');
        await view.key('m');
        assert.equal(view.tui.menuId, 'main');
        view.tui.setMenu('recon-deep');
        await view.key('', keys.right);
        assert.equal(view.tui.menuId, 'main');
        view.tui.setMenu('recon');
        await view.key('b');
        assert.equal(view.tui.menuId, 'main');
    });
});
describe('TUI · 执行', () => {
    it('Enter 执行后记录结果，o 可查看输出', async () => {
        const { executor, calls } = fakeExecutor(0, ['[hello] argv', 'hello-output']);
        const view = makeTui(demo, { execute: executor });
        await view.key('', keys.down); // 环境自检
        await view.key('\r', keys.enter);
        await view.idle();
        assert.equal(calls.length, 1);
        assert.match(calls[0]?.command ?? '', /node --version/);
        assert.equal(view.tui.lastRun?.code, 0);
        assert.equal(view.tui.lastRun?.name, '环境自检');
        await view.key('o');
        assert.match(view.text(), /hello-output/);
    });
    it('首页不显示上次执行结果', async () => {
        let clock = 1_000_000;
        const view = makeTui(demo, {
            execute: fakeExecutor(0, ['hidden-tail']).executor,
            now: () => clock,
        });
        await view.key('', keys.down);
        await view.key('\r', keys.enter);
        await view.idle();
        // 执行当下由底栏 toast 提示
        assert.match(view.text(), /退出码 0/);
        // 时间推进到 toast 过期后，首页不应再出现任何执行结果
        clock += 60_000;
        const text = view.text();
        assert.doesNotMatch(text, /退出码/);
        assert.doesNotMatch(text, /hidden-tail/);
        assert.doesNotMatch(text, /上次/);
        // 结果仍可通过 o 查看
        await view.key('o');
        assert.match(view.text(), /hidden-tail/);
    });
    it('非零退出码用错误色标记', async () => {
        const view = makeTui(demo, { execute: fakeExecutor(7, ['boom']).executor });
        await view.key('', keys.down);
        await view.key('\r', keys.enter);
        await view.idle();
        assert.equal(view.tui.lastRun?.code, 7);
        assert.match(view.text(), /退出码 7/);
    });
    it('o 打开上次输出；无记录时给出空状态', async () => {
        const view = makeTui(demo, { execute: fakeExecutor(0, ['tail-line']).executor });
        await view.key('o');
        assert.match(view.text(), /还没有执行记录/);
        await view.key('', keys.escape);
        await view.key('', keys.down);
        await view.key('\r', keys.enter);
        await view.idle();
        await view.key('o');
        assert.match(view.text(), /tail-line/);
    });
    it('arch_picker 开时先弹架构面板，选择后按该架构执行', async () => {
        const { executor, calls } = fakeExecutor(0);
        const view = makeTui(fake, { execute: executor });
        view.tui.index = view.tui.rows.findIndex((row) => row.item.name === '按架构分发');
        await view.key('\r', keys.enter);
        assert.equal(view.tui.modal?.kind, 'arch');
        await view.key('', keys.down);
        await view.key('', keys.down); // arm64
        await view.key('\r', keys.enter);
        await view.idle();
        assert.equal(calls.length, 1);
        assert.equal(view.tui.lastRun?.arch, 'ARM64');
        assert.match(calls[0]?.command ?? '', /arch\.js arm64/);
    });
});
describe('TUI · 弹层', () => {
    it('? 帮助，Esc 关闭', async () => {
        const view = makeTui(demo);
        await view.key('?');
        assert.equal(view.tui.modal?.kind, 'help');
        assert.match(view.text(), /工具列表/);
        await view.key('', keys.escape);
        assert.equal(view.tui.modal, null);
    });
    it('d 自检弹层含检查项', async () => {
        const view = makeTui(demo);
        await view.key('d');
        assert.equal(view.tui.modal?.kind, 'doctor');
        assert.match(view.text(), /环境自检/);
    });
    it('p 工具包弹层', async () => {
        const view = makeTui(fake);
        await view.key('p');
        assert.equal(view.tui.modal?.kind, 'packages');
        assert.match(view.text(), /工具包 · 共 \d+ 个/);
    });
    it('t 切换主题不破坏界面', async () => {
        const view = makeTui(demo);
        assert.equal(view.tui.themeName, 'dark');
        await view.key('t');
        assert.equal(view.tui.themeName, 'light');
        assert.match(view.text(), /QxCTF/);
    });
});
describe('TUI · 视图与设置', () => {
    it('左栏视图面板含主菜单 / 收藏 / 最近使用 / 设置', () => {
        const view = makeTui(fake);
        const sidebar = view.lines().map((line) => line.slice(0, 21)).join('\n');
        assert.match(sidebar, /⌂ 主菜单/);
        assert.match(sidebar, /★ 收藏/);
        assert.match(sidebar, /◷ 最近使用/);
        assert.match(sidebar, /⋮ 设置/);
    });
    it('点左栏主菜单从子菜单回到根菜单', async () => {
        const view = makeTui(fake);
        view.tui.setMenu('recon-deep');
        const row = findRow(view.lines(), '⌂ 主菜单');
        assert.ok(row >= 0);
        await view.click(4, row);
        assert.equal(view.tui.menuId, 'main');
    });
    it('点左栏设置进入设置页（不是弹层）', async () => {
        const view = makeTui(fake);
        const row = findRow(view.lines(), '⋮ 设置');
        assert.ok(row >= 0);
        await view.click(4, row);
        assert.equal(view.tui.menuId, '__settings');
        assert.equal(view.tui.modal, null);
        assert.match(view.text(), /手动选择架构/);
        assert.match(view.text(), /选项详情/);
        // 面包屑与列表标题都是「设置」
        assert.match(view.text(), /┌─ 路径 /);
    });
    it('视图图标都是单列宽，四行右边界对齐', () => {
        const view = makeTui(fake, { size: { columns: 100, rows: 24 } });
        for (const entry of SIDEBAR_ENTRIES) {
            assert.equal(strWidth(entry.icon), 1, `${entry.label} 图标应为单列宽`);
            assert.notEqual(entry.icon.codePointAt(0), 0x2699, '不要用 emoji 齿轮图标');
        }
        const rows = view.lines().slice(3, 7);
        const borders = rows.map((line) => strWidth(line.slice(0, line.indexOf('│', 1))));
        assert.equal(new Set(borders).size, 1, `右边界不一致：${borders.join(',')}`);
    });
    it('s 进入设置页，Enter 切换手动选择架构并写回 settings.json', () => {
        const dir = tempDir('qxctf-settings-');
        const configDir = makePackage(dir, {
            menu: minimalMenu,
            settings: { name: 'p', version: '1.0.0', archPicker: false }
        });
        const tui = new QxCtfTui({
            initial: loadBootstrap({ configDir }),
            loader: createLoader(),
            size: { columns: 100, rows: 26 }
        });
        tui.handleKeypress('s', {});
        assert.equal(tui.menuId, '__settings');
        assert.match(tui.snapshot(100, 26).join('\n'), /\[关\]/);
        tui.handleKeypress('\r', { name: 'return' });
        assert.equal(tui.bootstrap.settings.archPicker, true);
        assert.match(tui.snapshot(100, 26).join('\n'), /\[开\]/);
        const written = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
        assert.equal(written.archPicker, true);
        // 其它字段保留
        assert.equal(written.name, 'p');
    });
    it('设置页可以切回主菜单，且关闭详情框后首页不再显示', async () => {
        const view = makeTui(demo);
        assert.match(view.text(), /┌─ 详情 /);
        await view.key('s');
        assert.equal(view.tui.menuId, '__settings');
        await view.key('', keys.down);
        await view.key('', keys.down);
        await view.key('\r', keys.enter);
        assert.equal(view.tui.showDetail, false);
        // s / Esc 都能回主菜单
        await view.key('', keys.escape);
        assert.equal(view.tui.menuId, 'main');
        assert.doesNotMatch(view.text(), /┌─ 详情 /);
        // 列表仍在
        assert.match(view.text(), /┌─ 工具 /);
    });
    it('设置页按「行为 / 配色」分区，标题行不可选中', () => {
        const view = makeTui(fake, { size: { columns: 104, rows: 26 } });
        view.tui.setMenu('__settings');
        const text = view.text();
        assert.match(text, /行为 ───/);
        assert.match(text, /配色 ───/);
        // 分区标题不参与选择：下标仍只落在行为项上
        assert.equal(view.tui.settingsIndex, 0);
        assert.equal(view.tui.settingsItem.key, 'archPicker');
        const rows = view.tui.settingsLayoutRows();
        assert.equal(rows.filter((row) => row.kind === 'header').length, 2);
        assert.equal(rows.filter((row) => row.kind === 'item').length, SETTINGS_TOTAL);
    });
    it('设置页可以自定义强调色并写回 settings.json', () => {
        const dir = tempDir('qxctf-colors-');
        const configDir = makePackage(dir, {
            menu: minimalMenu,
            settings: { name: 'p', version: '1.0.0' }
        });
        const tui = new QxCtfTui({
            initial: loadBootstrap({ configDir }),
            loader: createLoader(),
            size: { columns: 110, rows: 30 }
        });
        // 没有自定义配色时用内置值
        assert.equal(tui.theme.accent, '#2f81f7');
        tui.handleKeypress('s', {});
        assert.equal(tui.menuId, '__settings');
        // 前 3 项是行为项，第 4 项是「强调色」
        for (let i = 0; i < 3; i += 1) {
            tui.handleKeypress('', { name: 'down' });
        }
        assert.equal(tui.settingsItem.label, '强调色');
        tui.handleKeypress('\r', { name: 'return' });
        assert.equal(tui.modal?.purpose, 'color');
        assert.equal(tui.modal?.value, '#2f81f7');
        tui.modal.value = '#ff8800';
        tui.handleKeypress('\r', { name: 'return' });
        assert.equal(tui.theme.accent, '#ff8800');
        assert.equal(tui.customColorCount(), 1);
        const written = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
        assert.deepEqual(written.colors, { dark: { accent: '#ff8800' } });
    });
    it('非法颜色被拒绝，重置后回到默认配色', () => {
        const dir = tempDir('qxctf-colors-');
        const configDir = makePackage(dir, {
            menu: minimalMenu,
            settings: { name: 'p', version: '1.0.0', colors: { dark: { accent: '#ff8800' } } }
        });
        const tui = new QxCtfTui({
            initial: loadBootstrap({ configDir }),
            loader: createLoader(),
            size: { columns: 110, rows: 30 }
        });
        assert.equal(tui.theme.accent, '#ff8800');
        tui.handleKeypress('s', {});
        // 强调色 = 第 4 项
        for (let i = 0; i < 3; i += 1) {
            tui.handleKeypress('', { name: 'down' });
        }
        tui.handleKeypress('\r', { name: 'return' });
        tui.modal.value = 'red';
        tui.handleKeypress('\r', { name: 'return' });
        assert.match(tui.modal?.error ?? '', /#rrggbb/);
        assert.equal(tui.theme.accent, '#ff8800');
        tui.handleKeypress('', { name: 'escape' });
        // 跳到「重置配色」（最后一项）
        for (let i = 0; i < 20; i += 1) {
            tui.handleKeypress('', { name: 'down' });
        }
        assert.equal(tui.settingsItem.key, 'resetColors');
        tui.handleKeypress('\r', { name: 'return' });
        assert.equal(tui.theme.accent, '#2f81f7');
        const written = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
        assert.equal(written.colors, undefined);
    });
    it('深浅两套自定义配色互不影响', () => {
        const dir = tempDir('qxctf-colors-');
        const configDir = makePackage(dir, {
            menu: minimalMenu,
            settings: {
                name: 'p',
                version: '1.0.0',
                colors: { dark: { accent: '#ff8800' }, light: { accent: '#0055ff' } }
            }
        });
        const tui = new QxCtfTui({
            initial: loadBootstrap({ configDir }),
            loader: createLoader(),
            size: { columns: 110, rows: 30 }
        });
        assert.equal(tui.theme.accent, '#ff8800');
        tui.handleKeypress('', { name: 'tab' });
        tui.handleKeypress('t', {});
        assert.equal(tui.themeName, 'light');
        assert.equal(tui.theme.accent, '#0055ff');
    });
});
describe('TUI · 鼠标', () => {
    it('点侧栏切到收藏视图', async () => {
        const view = makeTui(fake);
        const row = findRow(view.lines(), '★ 收藏');
        assert.ok(row >= 0);
        await view.click(4, row);
        assert.equal(view.tui.menuId, '__favorites');
    });
    it('点工具行选中，再点一次执行', async () => {
        const { executor, calls } = fakeExecutor(0);
        const view = makeTui(demo, { execute: executor });
        const row = findRow(view.lines(), '2  环境自检');
        assert.ok(row >= 0);
        await view.click(30, row);
        assert.equal(view.tui.index, 1);
        assert.equal(calls.length, 0);
        // 详情框高度固定，列表不会因为切换选项而位移
        assert.equal(findRow(view.lines(), '2  环境自检'), row);
        await view.click(30, row);
        await view.idle();
        assert.equal(calls.length, 1);
    });
    it('点 ★ 列收藏', async () => {
        const view = makeTui(fake);
        const lines = view.lines();
        const row = findRow(lines, '失败退出');
        const column = findColumn(lines, row, '失败退出') - 6;
        await view.click(Math.max(2, column), row);
        assert.equal(view.tui.favoriteCount, 1);
    });
    it('滚轮滚动列表', async () => {
        const view = makeTui(fake, { size: { columns: 96, rows: 18 } });
        await view.wheel('down');
        assert.equal(view.tui.index, 3);
        await view.wheel('up');
        assert.equal(view.tui.index, 0);
    });
    it('点底栏「? 帮助」打开帮助', async () => {
        const view = makeTui(demo);
        const lines = view.lines();
        const lastRow = lines.length - 1;
        const column = findColumn(lines, lastRow, '? 帮助');
        assert.ok(column > 0);
        await view.click(column, lastRow);
        assert.equal(view.tui.modal?.kind, 'help');
    });
});
