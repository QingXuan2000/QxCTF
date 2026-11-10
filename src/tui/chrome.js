/**
 * 界面外框：顶栏、侧边栏、底栏、弹层外框
 *
 * 工具箱取向：顶栏压到 2 行，把纵向空间留给工具列表；
 * 侧栏是「菜单树 + 收藏/最近」的分类索引，不做仪表盘式的状态堆叠。
 */
import path from 'node:path';
import { FAVORITES_VIEW, RECENT_VIEW, SIDEBAR_ENTRIES } from './model.js';
import { isListableItem } from '../core/menu.js';
import { Screen } from '../ui/screen.js';
import { padEndWidth, strWidth, truncateMiddle, wrapText } from '../ui/width.js';
import { PRODUCT } from '../version.js';
/** 缩短 home 前缀 */
function shortenHome(value) {
    const home = process.env['USERPROFILE'] ?? process.env['HOME'] ?? '';
    if (home !== '' && value.startsWith(home)) {
        return `~${value.slice(home.length)}`;
    }
    return value;
}
/** 毫秒 -> 人类可读 */
/** 时间戳 -> 相对时间 */
export function formatAgo(at, now = Date.now()) {
    if (at <= 0) {
        return '';
    }
    const diff = Math.max(0, now - at);
    if (diff < 60_000) {
        return '刚刚';
    }
    if (diff < 3_600_000) {
        return `${Math.floor(diff / 60_000)}m`;
    }
    if (diff < 86_400_000) {
        return `${Math.floor(diff / 3_600_000)}h`;
    }
    return `${Math.floor(diff / 86_400_000)}d`;
}
/** 右侧对齐绘制片段，返回左边界 */
/** 左侧对齐绘制片段，返回结束列 */
/** 键值行 */
/** 路径中间省略 */
export function shortPath(value, width) {
    return truncateMiddle(shortenHome(String(value ?? '')), width);
}
/** 顶栏右侧的标签胶囊：` text ` 带底色，像 GitHub 的 label */
function drawChip(screen, rightEdge, y, text, theme, color) {
    const label = ` ${text} `;
    const chipWidth = strWidth(label);
    const start = rightEdge - chipWidth;
    if (start < 1) {
        return rightEdge;
    }
    
    screen.text(start, y, label, { fg: color }, { maxWidth: chipWidth });
    return start - 1;
}
/** 当前工具包里可列出的工具数（不统计旧版 back/main 项） */
function countTools(bootstrap) {
    if (bootstrap === null) {
        return 0;
    }
    return Object.values(bootstrap.config.menu)
        .flatMap((node) => node.items)
        .filter((item) => isListableItem(item)).length;
}
/**
 * 顶栏（2 行）
 *
 * row0：`▌ 工具集名 版本` ······················ `6 工具` `★0` `X86_64 · Windows`
 * row1：整行细分隔线
 *
 * 顶栏只写当前工具集的名字与版本（框架名与版本不占位），路径在左栏「工具包」面板，
 * 右侧是全局计数与平台胶囊。
 */
export function drawHeader(app, screen, width, theme) {
    const bootstrap = app.bootstrap;
    const hbg = { bg: theme.base };
    screen.fillRect(0, 0, width, 2, { fg: theme.text, bg: theme.base });
    // ── 右侧标签胶囊（从右往左摆，放不下就自动省略）──────────────
    let rightEdge = width - 2;
    rightEdge = drawChip(screen, rightEdge, 0, `${bootstrap?.arch ?? '-'} · ${bootstrap?.os ?? '-'}`, theme, theme.muted);
    rightEdge = drawChip(screen, rightEdge, 0, `★ ${app.favoriteCount}`, theme, app.favoriteCount > 0 ? theme.warn : theme.dim);
    rightEdge = drawChip(screen, rightEdge, 0, `${countTools(bootstrap)} 工具`, theme, theme.muted);
    const rightLimit = rightEdge;
    // ── 左侧：主菜单 title + 版本 ──────────────────────────────
    screen.text(0, 0, '▌', { ...hbg, fg: theme.accent, bold: true }, { maxWidth: 1 });
    const rootTitle = (bootstrap?.config.menu.main?.title ?? '').replace(/\n/g, ' ').trim();
    const name = rootTitle === '' ? (bootstrap?.packageInfo.name ?? PRODUCT) : rootTitle;
    const version = bootstrap?.packageInfo.version ?? '';
    const versionWidth = version === '' ? 0 : strWidth(version) + 1;
    const nameWidth = Math.max(4, rightLimit - 3 - versionWidth);
    const nameEnd = screen.text(2, 0, name, { ...hbg, fg: theme.accent2, bold: true }, { maxWidth: nameWidth });
    if (version !== '') {
        screen.text(nameEnd + 1, 0, version, { ...hbg, fg: theme.dim }, {
            maxWidth: Math.max(0, rightLimit - nameEnd - 1) });
    }
    screen.hline(0, 1, width, { fg: theme.border, bg: theme.base });
}
/** 侧栏里的小面板：与内容区面板同色，靠边框区分，不会和底栏底色打架 */
function sideBox(screen, x, y, w, h, theme, title, rightTitle) {
    const bg = theme.base;
    screen.box(x, y, w, h, {
        title,
        ...(rightTitle === undefined ? {} : { rightTitle }),
        style: { fg: theme.text, bg },
        borderStyle: { fg: theme.border, bg },
        titleStyle: { fg: theme.title, bg, bold: true },
        rightTitleStyle: { fg: theme.dim, bg } });
}
/**
 * 左栏：两块直角面板
 *
 * ┌ 视图 ────────┐  主菜单 / 收藏 / 最近使用 / 设置
 * ├ 工具包 ──────┤  当前工具包名称、版本、路径 + 统计
 * └──────────────┘
 *
 * 菜单导航交给顶部面包屑与 Tab 键；左栏只放「视图切换」「设置」和「当前工具包」。
 * 终端太矮时退回两行无框形式，保证可用。
 */
export function drawSidebar(app, screen, theme, geometry) {
    const width = geometry.sidebarWidth;
    const { bodyY, bodyH } = geometry;
    // 整屏只有一个背景色：左栏也铺画布色，层次只靠边框与前景色
    screen.fillRect(0, bodyY, width, bodyH, { fg: theme.text, bg: theme.base });
    screen.vline(width - 1, bodyY, bodyH, { fg: theme.borderSoft, bg: theme.base });
    const entries = SIDEBAR_ENTRIES;
    const tools = countTools(app.bootstrap);
    const menus = app.bootstrap === null ? 0 : Object.keys(app.bootstrap.config.menu).length;
    const packages = app.bootstrap?.packages.length ?? 0;
    const compact = bodyH < 14;
    const viewH = Math.max(3, entries.length + 2);
    const gap = 1;
    const compactFooterRows = compact ? 2 : 0;
    const innerX = compact ? 1 : 2;
    const innerRight = compact ? width - 1 : width - 2;
    // ── ① 视图面板 ──────────────────────────────────────────
    const viewY = bodyY;
    if (!compact) {
        // 右上角常驻 Tab 提示：告诉用户这里可以用 Tab 换视图
        sideBox(screen, 0, viewY, width, viewH, theme, '视图', 'Tab 切换');
    }
    const firstRow = compact ? viewY : viewY + 1;
    entries.forEach((entry, index) => {
        const y = firstRow + index;
        const active = entry.id === app.menuId;
        const style = active
            ? { fg: theme.accent, bold: true }
            : { fg: theme.muted };
        if (active) {
            screen.text(compact ? 0 : 1, y, '▌', { fg: theme.accent, bold: true }, { maxWidth: 1 });
        }
        const suffix = entry.kind === 'favorites' && app.favoriteCount > 0 ? String(app.favoriteCount) : '';
        const labelX = innerX + 1;
        screen.text(labelX, y, `${entry.icon} ${entry.label}`, style, {
            maxWidth: Math.max(2, innerRight - labelX - (suffix === '' ? 0 : strWidth(suffix) + 1)) });
        if (suffix !== '') {
            screen.text(innerRight - strWidth(suffix), y, suffix, { fg: theme.dim }, {
                maxWidth: strWidth(suffix) });
        }
        screen.hit(compact ? 0 : 1, y, width - (compact ? 1 : 2), 1, () => app.clickNav(entry.id));
    });
    if (compact) {
        const baseY = bodyY + bodyH - compactFooterRows;
        if (baseY > firstRow + entries.length) {
            screen.hline(1, baseY - 1, Math.max(0, width - 3), { fg: theme.borderSoft });
        }
        screen.text(1, baseY, `${tools} 工具 · ★${app.favoriteCount}`, { fg: theme.muted }, {
            maxWidth: width - 2 });
        if (app.bootstrap !== null) {
            screen.text(1, baseY + 1, app.bootstrap.packageInfo.name, { fg: theme.dim }, {
                maxWidth: width - 2 });
        }
        return;
    }
    // ── ② 工具包面板：挤到左栏最底下，只占它需要的几行 ────────
    const packageH = Math.min(5, Math.max(4, bodyY + bodyH - (viewY + viewH + gap)));
    const packageY = bodyY + bodyH - packageH;
    if (app.bootstrap !== null) {
        sideBox(screen, 0, packageY, width, packageH, theme, '工具包', `${packages} 个`);
        const name = app.bootstrap.packageInfo.name;
        const version = app.bootstrap.packageInfo.version;
        const versionWidth = strWidth(version);
        screen.text(innerX, packageY + 1, name, { fg: theme.accent2, bold: true }, {
            maxWidth: Math.max(4, innerRight - innerX - versionWidth - 1) });
        screen.text(innerRight - versionWidth, packageY + 1, version, { fg: theme.dim }, { maxWidth: versionWidth });
        // 路径只占一行，中间省略，保证面板高度固定
        screen.text(innerX, packageY + 2, shortPath(app.bootstrap.packageRoot, Math.max(8, innerRight - innerX)), {
            fg: theme.dim }, { maxWidth: Math.max(4, innerRight - innerX) });
        // 面板窄到放不下统计时就省掉这一行，避免出现「6 工…」这种半截文字
        if (packageH >= 5 && innerRight - innerX >= 16) {
            screen.text(innerX, packageY + 3, `${menus} 菜单 · ${tools} 工具`, { fg: theme.dim }, {
                maxWidth: Math.max(4, innerRight - innerX) });
        }
        screen.hit(1, packageY, width - 2, packageH, () => app.openPackages());
    }
}
/** 底栏：键位提示 + 位置计数 + 提示 toast */
export function drawFooter(app, screen, width, height, theme, hints) {
    const y = height - 1;
    screen.fillRect(0, y, width, 1, { fg: theme.text, bg: theme.base });
    const toast = app.toast;
    if (toast !== null && toast.until > app.now) {
        const color = toast.level === 'err'
            ? theme.bad
            : toast.level === 'warn'
                ? theme.warn
                : toast.level === 'info'
                    ? theme.accent2
                    : theme.good;
        screen.text(1, y, toast.text, { fg: color, bold: true }, { maxWidth: width - 2 });
        return;
    }
    // 右侧：计数 + 帮助/退出（没有列表的页面不显示 0/0）
    const total = app.totalRows;
    const position = total > 0 ? `${app.index + 1}/${total}   ` : '';
    const right = `${position}? 帮助   q 退出`;
    const rightWidth = strWidth(right);
    const limit = Math.max(12, width - rightWidth - 2);
    let x = 1;
    hints.forEach(([key, label], index) => {
        if (x >= limit) {
            return;
        }
        if (key !== '') {
            x = screen.text(x, y, key, { fg: theme.accent, bold: true });
            x += 1;
        }
        if (label !== '') {
            x = screen.text(x, y, label, { fg: theme.muted }, { maxWidth: Math.max(0, limit - x) });
            x += 1;
        }
        if (index < hints.length - 1 && x < limit) {
            screen.text(x, y, '·', { fg: theme.dim });
            x += 2;
        }
    });
    if (width > 40) {
        const rightX = width - rightWidth - 1;
        screen.text(rightX, y, right, { fg: theme.dim }, { maxWidth: rightWidth });
        const helpText = '? 帮助';
        // position 里已经带了分隔空格，命中区从它后面直接开始
        const helpColumn = rightX + strWidth(position);
        screen.hit(helpColumn, y, strWidth(helpText), 1, () => app.openHelp());
        screen.hit(helpColumn + strWidth(helpText) + 3, y, strWidth('q 退出'), 1, () => app.requestQuit());
    }
}
/** 弹层外框 */
export function drawModalFrame(app, screen, area, width, height, theme, title) {
    const x = Math.max(0, area.x + Math.floor((area.w - width) / 2));
    const y = Math.max(0, area.y + Math.floor((area.h - height) / 2));
    // 无背景色可依赖，先把这块区域用空格抹掉，弹层才不会透出底下的面板
    screen.fillRect(x, y, width, height, { bg: theme.base });
    screen.box(x, y, width, height, {
        title,
        style: { fg: theme.text, bg: theme.base },
        borderStyle: { fg: theme.focusBorder, bg: theme.base },
        titleStyle: { fg: theme.title, bg: theme.base, bold: true },
        rightTitle: '[Esc]',
        rightTitleStyle: { fg: theme.dim, bg: theme.base } });
    const closeX = x + width - 7;
    screen.hit(closeX, y, 5, 1, () => app.cancelModal(), 'modal');
    return { x, y, width, height };
}
/** 弹层快捷键提示 */
export function modalHints(modal) {
    switch (modal.kind) {
        case 'help':
            return [['↑↓', '滚动'], ['?', '关闭']];
        case 'doctor':
        case 'output':
            return [['↑↓', '滚动'], ['Esc', '关闭']];
        case 'arch':
            return [['↑↓', '选择'], ['Enter', '按此架构执行'], ['Esc', '取消']];
        case 'packages':
            return [['↑↓', '选择'], ['Enter', '切换'], ['a', '添加'], ['d', '移除']];
        case 'filter':
            return [['输入', '即时过滤'], ['Enter', '保留'], ['Esc', '清空']];
        case 'input':
            return [['Enter', '载入'], ['Esc', '取消']];
    }
}
/** 两个虚拟视图的说明文字 */
/** 侧栏标签（虚拟视图用中文名） */
/** 兼容：包一层 wrapText 给帮助文本用 */
