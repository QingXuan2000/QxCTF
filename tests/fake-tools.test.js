/**
 * 假工具集端到端测试
 *
 * examples/fake-tools 覆盖了这些链路：args 引用、架构映射、cwd、退出码、
 * 三级菜单、back/main 菜单项、故意缺失的脚本、Unicode 输出、慢工具。
 * 这里既验证核心层的解析结果，也验证 TUI（零依赖渲染层）的真实交互。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { loadBootstrap } from '../src/core/bootstrap.js';
import { runDoctor } from '../src/core/doctor.js';
import { planExecution } from '../src/core/executor.js';
import { fakePackage, tempDir } from './helpers/fixtures.js';
import { fakeExecutor, findRow, keys, makeTui } from './helpers/tui.js';
let bootstrap;
before(() => {
    process.env['QXCTF_HOME'] = tempDir('qxctf-home-');
    bootstrap = loadBootstrap({ configDir: fakePackage });
});
function menuItem(menuId, id) {
    const node = bootstrap.config.menu[menuId];
    assert.ok(node !== undefined, `菜单 ${menuId} 不存在`);
    const item = node.items.find((candidate) => candidate.id === id);
    assert.ok(item !== undefined, `菜单项 ${menuId}:${id} 不存在`);
    return item;
}
describe('假工具集 · 配置', () => {
    it('三个菜单、十个可执行项、四个架构选项', () => {
        assert.deepEqual(Object.keys(bootstrap.config.menu).sort(), ['main', 'recon', 'recon-deep']);
        const execs = Object.values(bootstrap.config.menu)
            .flatMap((node) => node.items)
            .filter((item) => item.type === 'executable');
        assert.equal(execs.length, 10);
        // 架构选项来自 menu.json 的 path 键，不再有 arch_picker.json
        assert.deepEqual(bootstrap.archOptions.map((option) => option.value), ['X86_64', 'X86', 'ARM64', 'ARM32']);
    });
    it('settings 生效：架构选择器开、主题与配色', () => {
        assert.equal(bootstrap.packageInfo.name, 'fake-tools');
        assert.equal(bootstrap.packageInfo.version, '0.1.0');
        assert.equal(bootstrap.settings.archPicker, true);
        assert.equal(bootstrap.settings.themeName, 'dark');
        assert.equal(bootstrap.settings.colorMode, 'auto');
    });
});
describe('假工具集 · 执行计划', () => {
    it('args 里的中文空格被引用', () => {
        const plan = planExecution(menuItem('main', 1), { packageRoot: bootstrap.packageRoot, detectedArch: 'X86_64' });
        assert.equal(plan.command, 'node tools/hello.js --name "测试 包"');
        assert.equal(plan.cwd, bootstrap.packageRoot);
    });
    it('架构映射按候选顺序命中', () => {
        const item = menuItem('main', 2);
        const x64 = planExecution(item, { packageRoot: bootstrap.packageRoot, detectedArch: 'X86_64' });
        assert.equal(x64.arch, 'X86_64');
        assert.equal(x64.command, 'node tools/arch.js x86_64');
        const arm = planExecution(item, {
            packageRoot: bootstrap.packageRoot,
            detectedArch: 'X86_64',
            preferredArch: 'ARM64',
        });
        assert.equal(arm.arch, 'ARM64');
        assert.equal(arm.command, 'node tools/arch.js arm64');
        const unknown = planExecution(item, { packageRoot: bootstrap.packageRoot, detectedArch: 'Unknown' });
        assert.equal(unknown.arch, 'X86_64');
    });
    it('cwd 覆盖让相对路径生效', () => {
        const plan = planExecution(menuItem('main', 3), { packageRoot: bootstrap.packageRoot });
        assert.equal(plan.command, 'node hello.js');
        assert.equal(plan.cwd, path.join(bootstrap.packageRoot, 'tools'));
    });
    it('无空格的参数不加引号', () => {
        const plan = planExecution(menuItem('main', 10), { packageRoot: bootstrap.packageRoot });
        assert.equal(plan.command, 'node tools/hello.js --name 第十项');
    });
});
describe('假工具集 · doctor', () => {
    it('缺脚本被识别为可达性告警，而不是整体失败', () => {
        const report = runDoctor(fakePackage);
        const reach = report.checks.find((check) => check.name === '命令可达性');
        assert.ok(reach !== undefined);
        assert.equal(reach.level, 'warn');
        assert.match(reach.detail, /ghost\.js/);
        assert.equal(report.ok, true);
    });
    it('菜单统计正确', () => {
        const report = runDoctor(fakePackage);
        const menu = report.checks.find((check) => check.name === 'menu.json');
        assert.ok(menu !== undefined);
        assert.equal(menu.level, 'ok');
        assert.match(menu.detail, /3 个菜单 \/ 10 个可执行项/);
    });
});
describe('假工具集 · TUI', () => {
    it('渲染侧栏菜单树、工具行与选项详情', () => {
        const view = makeTui(bootstrap, { size: { columns: 110, rows: 30 } });
        const text = view.text();
        assert.match(text, /假工具集 \/ Fake Toolchain/);
        assert.match(text, /10  两位编号/);
        // main:1 的 detail 用单行字符串 + {command} 占位符
        assert.match(text, /调用 node tools\/hello\.js/);
        assert.match(text, /f 收藏/);
        // 导航项不再出现在列表里
        assert.doesNotMatch(text, /返回上级|返回主菜单/);
    });
    it('编号对齐：一位与两位数字的名称起始列一致', () => {
        const view = makeTui(bootstrap, { size: { columns: 110, rows: 30 } });
        const lines = view.lines();
        const row10 = findRow(lines, '两位编号');
        const row8 = findRow(lines, 'Unicode 输出');
        assert.ok(row10 >= 0 && row8 >= 0);
        const column10 = (lines[row10] ?? '').indexOf('两位编号');
        const column8 = (lines[row8] ?? '').indexOf('Unicode 输出');
        assert.equal(column10, column8);
    });
    it('三级菜单用 b / m 与面包屑进出', async () => {
        const view = makeTui(bootstrap);
        view.tui.setMenu('recon-deep');
        assert.equal(view.tui.menuId, 'recon-deep');
        assert.match(view.text(), /回显 stdin/);
        assert.match(view.text(), /›/);
        await view.key('b');
        assert.equal(view.tui.menuId, 'recon');
        await view.key('b');
        assert.equal(view.tui.menuId, 'main');
        // 直接切到最深层，再按 m 一次回到主菜单
        view.tui.setMenu('recon-deep');
        await view.key('m');
        assert.equal(view.tui.menuId, 'main');
    });
    it('过滤只留下一项', async () => {
        const view = makeTui(bootstrap);
        await view.key('/');
        await view.type('慢');
        await view.key('\r', keys.enter);
        assert.equal(view.tui.rows.length, 1);
        assert.equal(view.tui.rows[0]?.item.name, '慢工具');
        assert.match(view.text(), /慢工具/);
    });
    it('缺失脚本执行后记录非零退出码', async () => {
        const view = makeTui(bootstrap, {
            execute: () => Promise.resolve({ code: 1, signal: null, tail: ['Cannot find module'] }),
        });
        view.tui.index = view.tui.rows.findIndex((row) => row.item.name === '不存在的工具');
        assert.ok(view.tui.index >= 0);
        await view.key('\r', keys.enter);
        assert.equal(view.tui.modal?.kind, 'arch');
        await view.key('\r', keys.enter);
        await view.idle();
        assert.equal(view.tui.lastRun?.code, 1);
        assert.equal(view.tui.lastRun?.name, '不存在的工具');
        assert.match(view.text(), /退出码 1/);
        // 完整输出在 o 弹层里
        await view.key('o');
        assert.match(view.text(), /Cannot find module/);
    });
    it('慢工具执行后界面恢复可用', async () => {
        const { executor, calls } = fakeExecutor(0, ['[slow] 等待 800ms ...']);
        const view = makeTui(bootstrap, { execute: executor });
        view.tui.index = view.tui.rows.findIndex((row) => row.item.name === '慢工具');
        await view.key('\r', keys.enter); // 架构面板
        await view.key('\r', keys.enter); // 选第一个架构 → 执行
        await view.idle();
        assert.equal(calls.length, 1);
        assert.match(calls[0]?.command ?? '', /slow\.js/);
        assert.equal(view.tui.busy, false);
        assert.equal(view.tui.lastRun?.code, 0);
        assert.equal(view.tui.menuId, 'main');
        assert.equal(view.tui.rows[view.tui.index]?.item.name, '慢工具');
        // 首页不再显示上次输出，输出的最后一行在 o 弹层里
        assert.doesNotMatch(view.text(), /\[slow\] 等待 800ms/);
        await view.key('o');
        assert.match(view.text(), /\[slow\] 等待 800ms/);
    });
    it('工具包面板能看到当前包集合', async () => {
        const view = makeTui(bootstrap);
        await view.key('p');
        assert.equal(view.tui.modal?.kind, 'packages');
        assert.match(view.text(), /工具包 · 共 \d+ 个/);
    });
});
