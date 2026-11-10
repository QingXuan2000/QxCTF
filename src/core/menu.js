/**
 * 菜单导航模型
 *
 * 导航状态就是一条从 main 出发的菜单 ID 栈。所有操作都是纯函数，
 * TUI 只负责渲染与输入，状态变化集中在这里。
 */
import { QxCtfError } from './errors.js';
/** 根菜单 ID */
export const MAIN_MENU = 'main';
/**
 * 是否作为「工具选项」显示
 *
 * `back` / `main` 是旧版用来在列表里放导航的菜单项；现在导航交给面包屑与
 * 快捷键，这两类不再进入列表（配置仍兼容，不报错也不再显示）。
 */
export function isListableItem(item) {
    return item.type === 'executable' || item.type === 'submenu';
}
/** 新建导航栈 */
export function createStack(root = MAIN_MENU) {
    return [root];
}
/** 当前菜单 ID */
export function currentMenu(stack) {
    const last = stack[stack.length - 1];
    return last ?? MAIN_MENU;
}
/** 进入子菜单；已是当前菜单时不重复入栈 */
export function pushMenu(stack, menuId) {
    if (currentMenu(stack) === menuId) {
        return [...stack];
    }
    return [...stack, menuId];
}
/** 返回上级；根菜单时原样返回 */
export function popMenu(stack) {
    if (stack.length <= 1) {
        return [...stack];
    }
    return stack.slice(0, -1);
}
/** 回到根菜单 */
export function resetStack() {
    return [MAIN_MENU];
}
/** 取菜单节点，不存在则抛错 */
export function getMenu(config, menuId) {
    const node = config.menu[menuId];
    if (node === undefined) {
        throw new QxCtfError(`菜单不存在：${menuId}`, '检查 menu.json 中的菜单 ID 拼写');
    }
    return node;
}
/** 按编号取菜单项 */
export function getItem(menu, id) {
    return menu.items.find((item) => item.id === id);
}
/** 把菜单项翻译成动作；非法引用在此处被拦住 */
export function actionFor(item, config) {
    switch (item.type) {
        case 'submenu': {
            const target = item.submenu;
            if (target === undefined) {
                throw new QxCtfError(`菜单项 ${item.name} 缺少 submenu 目标`);
            }
            getMenu(config, target);
            return { kind: 'submenu', menuId: target };
        }
        case 'executable':
            return { kind: 'executable', item };
        case 'back':
            return { kind: 'back' };
        case 'main':
            return { kind: 'main' };
    }
}
/** 面包屑：主菜单 › 子菜单 › … */
export function breadcrumb(config, stack) {
    const labels = stack.map((menuId) => {
        const node = config.menu[menuId];
        if (node === undefined) {
            return menuId;
        }
        const title = node.title.replace(/\n/g, ' ').trim();
        return title === '' ? menuId : title;
    });
    return labels.join(' › ');
}
/** 菜单总项数，用于概览与诊断 */
export function countItems(config) {
    return Object.values(config.menu).reduce((sum, node) => sum + node.items.length, 0);
}
/**
 * 把命令行的目标表达式解析成菜单项，支持三种写法：
 * - `menu:id`  指定菜单与编号
 * - `id`       当前可见菜单（main）里的编号
 * - `名称`      全菜单按名称模糊匹配，命中多个时取第一个并给出候选说明
 */
export function resolveTarget(config, expression) {
    const expr = expression.trim();
    if (expr === '') {
        throw new QxCtfError('目标为空', '用法：qxctf run <menu:id | id | 名称>');
    }
    if (expr.includes(':')) {
        const [menuId, idText] = expr.split(':', 2);
        if (menuId !== undefined && idText !== undefined) {
            const node = getMenu(config, menuId);
            const numeric = Number.parseInt(idText, 10);
            if (!Number.isNaN(numeric)) {
                const item = getItem(node, numeric);
                if (item !== undefined) {
                    return { menuId, item };
                }
                throw new QxCtfError(`菜单 ${menuId} 中没有 id=${numeric} 的菜单项`);
            }
            const byName = node.items.find((item) => item.name.includes(idText));
            if (byName !== undefined) {
                return { menuId, item: byName };
            }
            throw new QxCtfError(`菜单 ${menuId} 中没有匹配 “${idText}” 的菜单项`);
        }
    }
    const numeric = Number.parseInt(expr, 10);
    if (!Number.isNaN(numeric) && /^\d+$/.test(expr)) {
        const main = getMenu(config, MAIN_MENU);
        const item = getItem(main, numeric);
        if (item === undefined) {
            throw new QxCtfError(`主菜单中没有 id=${numeric} 的菜单项`, '先运行 `qxctf list` 查看编号');
        }
        return { menuId: MAIN_MENU, item };
    }
    const matches = [];
    for (const [menuId, node] of Object.entries(config.menu)) {
        for (const item of node.items) {
            if (item.type === 'executable' && item.name.includes(expr)) {
                matches.push({ menuId, item });
            }
        }
    }
    const first = matches[0];
    if (first === undefined) {
        throw new QxCtfError(`没有名称包含 “${expr}” 的可执行菜单项`, '先运行 `qxctf list` 查看可用工具');
    }
    return first;
}
