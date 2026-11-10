import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAIN_MENU, actionFor, breadcrumb, createStack, currentMenu, getItem, getMenu, popMenu, pushMenu, resetStack, resolveTarget, } from '../src/core/menu.js';
const config = {
    menu: {
        main: {
            title: '主菜单',
            items: [
                { id: 1, name: '信息收集', type: 'submenu', submenu: 'recon' },
                { id: 2, name: '扫描器', type: 'executable', path: 'nmap -sV' },
                { id: 3, name: '返回', type: 'back' },
                { id: 4, name: '主菜单', type: 'main' },
            ],
        },
        recon: {
            title: '信息收集',
            parent: 'main',
            items: [
                { id: 1, name: '子域枚举', type: 'executable', path: 'subfinder' },
                { id: 2, name: '目录爆破', type: 'executable', path: 'ffuf' },
            ],
        },
    },
};
describe('菜单栈', () => {
    it('从 main 开始并且可以进出', () => {
        let stack = createStack();
        assert.equal(currentMenu(stack), MAIN_MENU);
        stack = pushMenu(stack, 'recon');
        assert.equal(currentMenu(stack), 'recon');
        assert.deepEqual(stack, ['main', 'recon']);
        stack = popMenu(stack);
        assert.deepEqual(stack, ['main']);
        // 根菜单再返回仍然停在根菜单
        assert.deepEqual(popMenu(stack), ['main']);
    });
    it('重复进入同一菜单不叠加栈深', () => {
        const stack = pushMenu(createStack(), 'recon');
        assert.deepEqual(pushMenu(stack, 'recon'), ['main', 'recon']);
    });
    it('可以回到主菜单', () => {
        const stack = pushMenu(pushMenu(createStack(), 'recon'), 'main');
        assert.deepEqual(resetStack(), ['main']);
        assert.equal(stack.length, 3);
    });
});
describe('菜单查询', () => {
    it('取菜单与菜单项', () => {
        assert.equal(getMenu(config, 'recon').title, '信息收集');
        assert.equal(getItem(getMenu(config, 'main'), 2)?.name, '扫描器');
        assert.equal(getItem(getMenu(config, 'main'), 99), undefined);
    });
    it('菜单不存在时抛出可读错误', () => {
        assert.throws(() => getMenu(config, 'nope'), /菜单不存在：nope/);
    });
    it('面包屑按栈拼接标题', () => {
        assert.equal(breadcrumb(config, ['main']), '主菜单');
        assert.equal(breadcrumb(config, ['main', 'recon']), '主菜单 › 信息收集');
    });
});
describe('菜单动作', () => {
    const item = (id) => getItem(getMenu(config, 'main'), id);
    it('submenu 解析成进入动作', () => {
        const target = item(1);
        assert.ok(target !== undefined);
        assert.deepEqual(actionFor(target, config), { kind: 'submenu', menuId: 'recon' });
    });
    it('executable / back / main 分别映射', () => {
        const exec = item(2);
        const back = item(3);
        const main = item(4);
        assert.ok(exec !== undefined && back !== undefined && main !== undefined);
        assert.equal(actionFor(exec, config).kind, 'executable');
        assert.equal(actionFor(back, config).kind, 'back');
        assert.equal(actionFor(main, config).kind, 'main');
    });
    it('指向不存在子菜单时报错', () => {
        const broken = {
            menu: { main: { title: '', items: [{ id: 1, name: '坏', type: 'submenu', submenu: 'ghost' }] } },
        };
        const target = getItem(getMenu(broken, 'main'), 1);
        assert.ok(target !== undefined);
        assert.throws(() => actionFor(target, broken), /菜单不存在：ghost/);
    });
});
describe('目标解析', () => {
    it('menu:id 形式', () => {
        const resolved = resolveTarget(config, 'recon:2');
        assert.equal(resolved.menuId, 'recon');
        assert.equal(resolved.item.name, '目录爆破');
    });
    it('裸编号指向主菜单', () => {
        const resolved = resolveTarget(config, '2');
        assert.equal(resolved.menuId, 'main');
        assert.equal(resolved.item.name, '扫描器');
    });
    it('名称模糊匹配只匹配可执行项', () => {
        const resolved = resolveTarget(config, '目录');
        assert.equal(resolved.item.name, '目录爆破');
        assert.throws(() => resolveTarget(config, '信息收集'), /没有名称包含/);
    });
    it('无效输入给出可执行提示', () => {
        assert.throws(() => resolveTarget(config, ''), /目标为空/);
        assert.throws(() => resolveTarget(config, 'main:77'), /没有 id=77/);
        assert.throws(() => resolveTarget(config, '不存在的东西'), /没有名称包含/);
    });
});
