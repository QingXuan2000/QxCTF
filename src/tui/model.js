/**
 * TUI 数据模型
 *
 * 渲染层（chrome / views）只读这个接口，交互（app）只改这里定义的状态。
 * 设计目标是「工具箱」而不是仪表盘：一份工具列表是主视图，菜单树只是分类索引，
 * 收藏与最近使用是两个常驻的虚拟视图。
 */
/** 终端最小尺寸 */
export const MIN_WIDTH = 64;
export const MIN_HEIGHT = 16;
/** 虚拟视图：收藏 / 最近使用 */
export const FAVORITES_VIEW = '__favorites';
export const RECENT_VIEW = '__recent';
/** 按 parent 关系把菜单展开成一棵树（DFS 顺序，main 打头） */
function navTree(config) {
    const entries = [];
    const visited = new Set();
    const walk = (menuId, depth) => {
        const node = config.menu[menuId];
        if (node === undefined || visited.has(menuId) || depth > 8) {
            return;
        }
        visited.add(menuId);
        const title = node.title.replace(/\n/g, ' ').trim();
        entries.push({ id: menuId, label: title === '' ? menuId : title, depth, kind: 'menu' });
        for (const [childId, child] of Object.entries(config.menu)) {
            if (child.parent === menuId && childId !== menuId) {
                walk(childId, depth + 1);
            }
        }
    };
    if (config.menu['main'] !== undefined) {
        walk('main', 0);
    }
    for (const menuId of Object.keys(config.menu)) {
        if (!visited.has(menuId)) {
            walk(menuId, 0);
        }
    }
    return entries;
}
/** 侧边栏完整导航：菜单树 + 两个虚拟视图 */
export function navEntries(config) {
    return [
        ...navTree(config),
        { id: FAVORITES_VIEW, label: '收藏', depth: 0, kind: 'favorites' },
        { id: RECENT_VIEW, label: '最近使用', depth: 0, kind: 'recent' },
    ];
}
/** 设置页（和收藏 / 最近使用一样是独立视图，不是弹层） */
export const SETTINGS_VIEW = '__settings';
/** 设置页的行为项 */
export const SETTINGS_ITEMS = [
    { key: 'archPicker', label: '手动选择架构', hint: '执行工具前先选架构' },
    { key: 'theme', label: '主题', hint: '深色 / 浅色' },
    { key: 'detail', label: '选项详情', hint: '首页详情线框' },
];
/** 设置页的配色项（当前主题下可覆盖的色位） */
export const COLOR_ITEMS = [
    { key: 'accent', label: '强调色', hint: '品牌、选中竖条' },
    { key: 'title', label: '标题色', hint: '面板标题' },
    { key: 'text', label: '正文色', hint: '主要文字' },
    { key: 'muted', label: '次要色', hint: '说明文字' },
    { key: 'border', label: '线框色', hint: '面板边框' },
    { key: 'base', label: '背景色', hint: '整屏统一底色' },
    { key: 'good', label: '成功色', hint: '成功结果' },
    { key: 'warn', label: '警告色', hint: '警告结果' },
    { key: 'bad', label: '错误色', hint: '失败结果' },
];
/** 重置配色（放在配色区末尾） */
export const RESET_ITEM = { key: 'resetColors', label: '恢复默认配色', hint: '清掉当前主题的自定义' };
/** 设置页分区：标题 + 条目，顺序即页面顺序 */
export const SETTINGS_SECTIONS = [
    { title: '行为', items: SETTINGS_ITEMS },
    { title: '配色', items: [...COLOR_ITEMS, RESET_ITEM] },
];
/** 分区摊平后的条目表（选择下标就是它的下标） */
export const SETTINGS_FLAT = SETTINGS_SECTIONS.flatMap((section) => section.items);
/** 设置页条目总数 */
export const SETTINGS_TOTAL = SETTINGS_FLAT.length;
/**
 * 左栏「视图」面板的固定入口
 *
 * 不列菜单树：主菜单跳根、两个虚拟视图、加上「设置」页。
 * 图标只用单列宽、文本呈现的符号（不用 ⚙ 这类 emoji：终端会按两列彩色字形渲染，
 * 行会因此变宽、和其它行对不齐）。
 */
export const SIDEBAR_ENTRIES = [
    { id: 'main', label: '主菜单', kind: 'main', icon: '⌂' },
    { id: FAVORITES_VIEW, label: '收藏', kind: 'favorites', icon: '★' },
    { id: RECENT_VIEW, label: '最近使用', kind: 'recent', icon: '◷' },
    { id: SETTINGS_VIEW, label: '设置', kind: 'settings', icon: '⋮' },
];
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
export function scrollTop(index, top, visible, total) {
    let next = top;
    if (index < next) {
        next = index;
    }
    if (index >= next + visible) {
        next = index - visible + 1;
    }
    return clamp(next, 0, Math.max(0, total - visible));
}
/** 菜单项类型标签 */
export function badgeOf(item) {
    switch (item.type) {
        case 'submenu':
            return '菜单';
        case 'executable':
            return '执行';
        case 'back':
            return '返回';
        case 'main':
            return '主菜单';
    }
    return item.type;
}
/**
 * 是否作为列表项显示
 *
 * `back` / `main` 属于旧版的导航菜单项，现在由面包屑 + 快捷键承担，
 * 不再出现在工具列表里（配置仍兼容，不会报错）。
 */
export { isListableItem as isListable } from '../core/menu.js';
/** 面包屑第一段固定显示「根目录」，其余用菜单标题 */
export const ROOT_CRUMB = '根目录';
/** 由导航栈生成面包屑（根目录在最左，当前菜单在最右） */
export function crumbSegments(config, stack, currentTitle) {
    const segments = [];
    stack.forEach((menuId, index) => {
        const isLast = index === stack.length - 1;
        const title = (config.menu[menuId]?.title ?? '').replace(/\n/g, ' ').trim();
        const label = index === 0
            ? ROOT_CRUMB
            : isLast ? currentTitle : title === '' ? menuId : title;
        segments.push({ id: menuId, label: label === '' ? menuId : label });
    });
    return segments;
}
export function geometryFor(width, height) {
    const w = Math.max(MIN_WIDTH, width);
    const h = Math.max(MIN_HEIGHT, height);
    const headerHeight = 2;
    const sidebarWidth = w >= 118 ? 24 : w >= 96 ? 22 : 18;
    const bodyY = headerHeight;
    const bodyH = h - headerHeight - 1;
    const contentX = sidebarWidth + 1;
    return {
        width: w,
        height: h,
        sidebarWidth,
        headerHeight,
        bodyY,
        bodyH,
        // 右边缘直接顶到终端最后一列：整屏铺满，不留空列
        content: { x: contentX, y: bodyY, w: w - contentX, h: bodyH },
    };
}
/** 面包屑 */
export function breadcrumb(config, stack) {
    return stack
        .map((menuId) => {
        const title = (config.menu[menuId]?.title ?? '').replace(/\n/g, ' ').trim();
        return title === '' ? menuId : title;
    })
        .join(' › ');
}
/** 命令摘要：太长就截断到指定显示宽度 */
