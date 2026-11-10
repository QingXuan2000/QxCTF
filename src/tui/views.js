/**
 * 视图绘制
 *
 * 工具箱的主视图就是一份工具清单：面包屑 / 选项详情 / 工具行。
 * 底部不再放命令条或执行结果；命令与说明都进详情区，执行结果按 `o` 查看。
 */
import { FAVORITES_VIEW, RECENT_VIEW, SETTINGS_TOTAL, SETTINGS_VIEW, badgeOf, clamp, crumbSegments } from './model.js';
import { drawModalFrame, formatAgo, modalHints, shortPath } from './chrome.js';
import { Screen } from '../ui/screen.js';
import { clipText, strWidth, wrapText } from '../ui/width.js';
/** 底部固定占位：分隔线 1 + 命令条 1 + 详情区（行数随手高度伸缩） */
/** 详情区行数：随内容区高度伸缩（参数是内容区高度） */
function detailRowCount(height) {
    if (height >= 24) {
        return 3;
    }
    if (height >= 19) {
        return 2;
    }
    if (height >= 14) {
        return 1;
    }
    return 0;
}
/** 详情里的占位符 */
const DETAIL_TOKEN = /\{(\w+)\}/g;
/** 详情区的 token 表 */
function detailTokens(row) {
    const plan = row.plan;
    return {
        command: plan?.command ?? '',
        cwd: plan?.cwd ?? '',
        arch: plan === null ? '' : plan.arch === 'default' ? '通用' : plan.arch,
        name: row.item.name,
        id: String(row.item.id),
        menu: row.menuId,
        type: badgeOf(row.item),
        desc: row.item.desc ?? '' };
}
/** 没写 detail 时的兜底详情 */
function fallbackDetail(app, row, width) {
    if (row.planError !== null) {
        return [`命令解析失败：${row.planError}`];
    }
    if (row.plan !== null) {
        return [
            `命令  ${row.plan.command}`,
            `目录  ${shortPath(row.plan.cwd, Math.max(12, width - 8))}`,
            row.plan.arch === 'default' ? '架构  通用命令' : `架构  ${row.plan.arch}`,
        ];
    }
    if (row.item.type === 'submenu') {
        const count = app.bootstrap?.config.menu[row.item.submenu ?? '']?.items.length ?? 0;
        return [`进入 ${row.item.submenu ?? '?'}（${count} 项）`];
    }
    return [row.item.type === 'back' ? '操作  返回上级菜单' : '操作  回到主菜单'];
}
/**
 * 生成详情区文本行
 *
 * 优先用 `menu.json` 里的 `detail`（字符串或数组），支持占位符；
 * 没配就退回自动摘要（目录 / 子菜单项数 / 操作类型）。
 */
function buildDetailLines(app, row, width) {
    const tokens = detailTokens(row);
    const configured = row.item.detail;
    const raw = configured === undefined
        ? fallbackDetail(app, row, width)
        : Array.isArray(configured)
            ? configured
            : String(configured).split('\n');
    const lines = [];
    for (const entry of raw) {
        const text = String(entry).replace(DETAIL_TOKEN, (_match, key) => tokens[key] ?? `{${key}}`);
        // 一条配置 = 一行详情，超宽用省略号截断（想换行就在配置里写数组）
        const line = clipText(text, Math.max(8, width), '…');
        if (line.trim() !== '') {
            lines.push(line);
        }
    }
    return lines;
}
/** 要执行的命令（不是描述） */
function rowCommand(row) {
    if (row.planError !== null) {
        return row.planError;
    }
    if (row.plan !== null) {
        return row.plan.command;
    }
    if (row.item.type === 'submenu') {
        return `进入 ${row.item.submenu ?? '?'}`;
    }
    return row.item.type === 'back' ? '返回上级' : '回到主菜单';
}
/** 行内的描述/命令列 */
function rowSubtitle(row) {
    if (row.planError !== null) {
        return row.planError;
    }
    if (row.item.desc !== undefined && row.item.desc !== '') {
        return row.item.desc;
    }
    return rowCommand(row);
}
/** 行尾徽标 */
function rowBadge(app, row) {
    if (app.menuId === RECENT_VIEW && row.recentAt > 0) {
        return formatAgo(row.recentAt, app.now);
    }
    return badgeOf(row.item);
}
/** 内容面板：线框 + 标题 + 右上角说明 */
function panel(screen, x, y, w, h, theme, title, rightTitle) {
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
 * 工具列表主视图
 *
 * 三块线框自上而下：面包屑 / 选项详情 / 工具列表。
 * 设置页走独立渲染（drawSettingsView），不再以弹层出现。
 * 终端太矮或太窄时退化成无框紧凑布局，保证仍然可用。
 */
export function drawToolsView(app, screen, area, theme) {
    if (app.menuId === SETTINGS_VIEW) {
        drawSettingsView(app, screen, area, theme);
        return;
    }
    const { x, y, w, h } = area;
    const current = app.rows[app.index];
    const counter = app.filter === ''
        ? `${app.rows.length} 项`
        : `${app.rows.length}/${app.totalRows} 项`;
    const filterChip = app.filter === '' ? '' : `过滤: ${app.filter}`;
    const compact = h < 12 || w < 30;
    // 设置弹层可以关掉详情框（app.showDetail）
    const maxDetail = current === undefined || app.showDetail === false ? 0 : detailRowCount(h);
    const detailLines = current === undefined
        ? []
        : buildDetailLines(app, current, compact ? w - 4 : w - 7).slice(0, maxDetail);
    let cursor = y;
    // ── ① 面包屑框 ────────────────────────────────────────────
    const crumbHeight = compact ? 1 : 3;
    if (!compact) {
        panel(screen, x, cursor, w, crumbHeight, theme, '路径');
    }
    const crumbRow = compact ? cursor : cursor + 1;
    const crumbStartX = compact ? x + 1 : x + 2;
    const crumbLimitX = x + w - (compact ? 2 : 3);
    const crumbs = app.bootstrap === null
        ? []
        : crumbSegments(app.bootstrap.config, app.stack, app.title);
    const separator = ' › ';
    let cx = crumbStartX;
    for (let index = 0; index < crumbs.length; index += 1) {
        const crumb = crumbs[index];
        if (crumb === undefined) {
            continue;
        }
        const isLast = index === crumbs.length - 1;
        const labelWidth = strWidth(crumb.label);
        if (cx + labelWidth > crumbLimitX) {
            screen.text(cx, crumbRow, '…', { fg: theme.dim }, { maxWidth: 1 });
            break;
        }
        screen.text(cx, crumbRow, crumb.label, {
            fg: isLast ? theme.title : theme.accent2,
            bold: isLast }, { maxWidth: labelWidth });
        if (!isLast) {
            const target = crumb.id;
            screen.hit(cx, crumbRow, labelWidth, 1, () => app.setMenu(target));
            const sepX = cx + labelWidth;
            if (sepX + strWidth(separator) <= crumbLimitX) {
                screen.text(sepX, crumbRow, separator, { fg: theme.dim }, {
                    maxWidth: strWidth(separator) });
            }
        }
        cx += labelWidth + (isLast ? 0 : strWidth(separator));
    }
    if (filterChip !== '') {
        const chipX = x + w - (compact ? 2 : 3) - strWidth(filterChip);
        screen.text(chipX, crumbRow, filterChip, { fg: theme.accent2, bold: true }, {
            maxWidth: strWidth(filterChip) });
    }
    cursor += crumbHeight;
    // ── ② 选项详情框（固定高度，避免切换选项时列表跳动）──────
    if (maxDetail > 0) {
        const detailHeight = maxDetail + 2;
        panel(screen, x, cursor, w, detailHeight, theme, '详情', current?.item.name);
        for (let offset = 0; offset < maxDetail; offset += 1) {
            const line = detailLines[offset];
            if (line === undefined) {
                break;
            }
            const ly = cursor + 1 + offset;
            screen.text(x + 2, ly, '·', { fg: theme.dim }, { maxWidth: 1 });
            screen.text(x + 4, ly, line, { fg: theme.muted }, { maxWidth: Math.max(8, w - 6) });
        }
        cursor += detailHeight;
    }
    // ── ③ 工具列表框（铺到内容区底边）────────────────────────
    const listHeight = Math.max(3, y + h - cursor);
    const listTop = cursor + 1;
    const visible = Math.max(1, listHeight - 2);
    // 菜单项可以按分区组织：同一分区的行前面插一行分区标题。
    // 收藏 / 最近使用是跨菜单聚合，分组没有意义，一律平铺。
    const groupSections = app.menuId !== FAVORITES_VIEW && app.menuId !== RECENT_VIEW;
    const display = [];
    let lastSection = null;
    app.rows.forEach((row, index) => {
        const section = groupSections ? (row.item.section ?? '').trim() : '';
        if (section !== '' && section !== lastSection) {
            display.push({ kind: 'header', label: section });
        }
        lastSection = section === '' ? null : section;
        display.push({ kind: 'row', index, row });
    });
    const selectedDisplay = Math.max(0, display.findIndex((entry) => entry.kind === 'row' && entry.index === app.index));
    const top = clamp(selectedDisplay - Math.floor(visible / 2), 0, Math.max(0, display.length - visible));
    app.top = top;
    const above = display.length > visible ? top : 0;
    const below = Math.max(0, display.length - top - visible);
    const scrollChip = [above > 0 ? `↑${above}` : '', below > 0 ? `↓${below}` : ''].filter((part) => part !== '');
    const listRightTitle = scrollChip.length === 0 ? counter : `${counter} · ${scrollChip.join(' ')}`;
    panel(screen, x, cursor, w, listHeight, theme, '工具', listRightTitle);
    if (app.rows.length === 0) {
        const empty = app.menuId === FAVORITES_VIEW
            ? '还没有收藏。选中工具后按 f 加入收藏。'
            : app.menuId === RECENT_VIEW
                ? '还没有执行记录。执行任意工具后会出现在这里。'
                : app.filter === ''
                    ? '（这个菜单没有工具）'
                    : `没有匹配 “${app.filter}” 的工具`;
        screen.text(x + 2, listTop, empty, { fg: theme.muted }, { maxWidth: Math.max(8, w - 4) });
    }
    const starColumn = x + 2;
    const idColumn = x + 4;
    const nameColumn = x + 8;
    const nameWidth = clamp(Math.floor((w - 20) * 0.42), 12, 30);
    const badgeRight = x + w - 3;
    for (let offset = 0; offset < visible; offset += 1) {
        const entry = display[top + offset];
        if (entry === undefined) {
            break;
        }
        const ly = listTop + offset;
        // 分区标题：`分区名 ─────`
        if (entry.kind === 'header') {
            const label = `${entry.label} `;
            const labelW = strWidth(label);
            screen.text(x + 1, ly, label, { fg: theme.accent2, bold: true }, { maxWidth: labelW });
            const lineW = w - 3 - (x + 1 + labelW - x);
            if (lineW > 2) {
                screen.hline(x + 1 + labelW, ly, lineW, { fg: theme.borderSoft });
            }
            continue;
        }
        const { index, row } = entry;
        const selected = index === app.index;
        const style = selected
            ? { fg: theme.accent, bold: true }
            : { fg: theme.text };
        if (selected) {
            screen.text(x + 1, ly, '▌', { fg: theme.accent, bold: true }, { maxWidth: 1 });
        }
        // 收藏星标（可点击；未收藏时留空，避免整列都是点）
        screen.text(starColumn, ly, row.favorite ? '★' : ' ', {
            fg: row.favorite ? theme.warn : theme.dim,
            bold: row.favorite }, { maxWidth: 1 });
        // 编号
        screen.text(idColumn, ly, String(row.item.id).padStart(2, ' '), {
            fg: selected ? theme.accent : theme.dim,
            bold: selected }, { maxWidth: 3 });
        // 名称
        screen.text(nameColumn, ly, row.item.name, { ...style, bold: selected }, { maxWidth: nameWidth });
        // 描述 / 命令
        const badge = rowBadge(app, row);
        const badgeWidth = strWidth(badge);
        const subX = nameColumn + nameWidth + 2;
        const subWidth = badgeRight - badgeWidth - 2 - subX;
        if (subWidth > 6) {
            screen.text(subX, ly, rowSubtitle(row), {
                fg: row.planError !== null ? theme.bad : selected ? theme.muted : theme.dim }, { maxWidth: subWidth });
        }
        // 类型 / 相对时间徽标
        screen.text(badgeRight - badgeWidth, ly, badge, {
            fg: selected ? theme.muted : row.item.type === 'executable' ? theme.accent2 : theme.dim }, { maxWidth: badgeWidth });
        screen.hit(x + 1, ly, w - 2, 1, () => app.clickRow(index));
        // 星标命中要压在整行命中之上（后者先注册，反查时先命中星标）
        screen.hit(starColumn, ly, 1, 1, () => app.toggleFavoriteAt(index));
    }
}
/**
 * 设置页（独立视图，不是弹层）
 *
 * ┌ 路径 ─────────────────────┐  面包屑：设置
 * ├ 设置 ─────────────── 3 项 ┤  条目 + 当前值 + 说明
 * └───────────────────────────┘
 */
function drawSettingsView(app, screen, area, theme) {
    const { x, y, w, h } = area;
    const compact = h < 12 || w < 30;
    // ── ① 面包屑框 ──
    const crumbHeight = compact ? 1 : 3;
    if (!compact) {
        panel(screen, x, y, w, crumbHeight, theme, '路径');
    }
    const crumbRow = compact ? y : y + 1;
    screen.text(compact ? x + 1 : x + 2, crumbRow, '设置', { fg: theme.title, bold: true }, {
        maxWidth: Math.max(2, w - 6) });
    // ── ② 设置条目框 ──
    const listTop = y + crumbHeight;
    const listHeight = Math.max(3, y + h - listTop);
    if (!compact) {
        panel(screen, x, listTop, w, listHeight, theme, '设置', `${SETTINGS_TOTAL} 项`);
    }
    const innerX = compact ? x + 1 : x + 2;
    const innerRight = x + w - (compact ? 1 : 2);
    const rowStart = compact ? listTop : listTop + 1;
    const visible = Math.max(1, (listTop + listHeight - 1) - rowStart);
    // 列表比可视区高时跟着选中项滚动（底部留一行放说明）
    const rowBudget = Math.max(1, visible - 2);
    const rows = app.settingsLayoutRows();
    const selectedRow = Math.max(0, rows.findIndex((row) => row.kind === 'item' && row.index === app.settingsIndex));
    const top = clamp(selectedRow - Math.floor(rowBudget / 2), 0, Math.max(0, rows.length - rowBudget));
    // 标签列宽固定，右侧说明与数值才能对齐
    const labelWidth = clamp(Math.floor((innerRight - innerX) * 0.42), 10, 22);
    for (let offset = 0; offset < rowBudget; offset += 1) {
        const row = rows[top + offset];
        if (row === undefined) {
            break;
        }
        const ly = rowStart + offset;
        // ── 分区标题：`行为 ─────────` 形式，不参与选择 ──
        if (row.kind === 'header') {
            const label = `${row.label} `;
            const labelW = strWidth(label);
            screen.text(innerX, ly, label, { fg: theme.accent2, bold: true }, { maxWidth: labelW });
            const lineW = innerRight - (innerX + labelW);
            if (lineW > 2) {
                screen.hline(innerX + labelW, ly, lineW, { fg: theme.borderSoft });
            }
            continue;
        }
        const selected = row.index === app.settingsIndex;
        const style = selected ? { fg: theme.accent, bold: true } : { fg: theme.text };
        if (selected) {
            screen.text(compact ? x : x + 1, ly, '▌', { fg: theme.accent, bold: true }, { maxWidth: 1 });
        }
        const valueText = `[${row.value}]`;
        const valueWidth = strWidth(valueText);
        screen.text(innerX + 1, ly, row.label, style, { maxWidth: labelWidth });
        const hintX = innerX + labelWidth + 2;
        const hintWidth = innerRight - valueWidth - 2 - hintX;
        if (hintWidth > 6) {
            screen.text(hintX, ly, row.hint, { fg: theme.dim }, { maxWidth: hintWidth });
        }
        screen.text(innerRight - valueWidth, ly, valueText, {
            fg: selected ? theme.accent2 : theme.muted }, { maxWidth: valueWidth });
        screen.hit(compact ? x : x + 1, ly, w - 2, 1, () => app.toggleSettingsItem(row.index));
    }
    // ── ③ 底部说明：当前主题 + 自定义数量 ──
    const noteY = rowStart + rowBudget;
    if (noteY < listTop + listHeight - 1) {
        const custom = app.customColorCount();
        const note = `${app.themeName === 'dark' ? '深色' : '浅色'}主题 · ${custom === 0 ? '使用默认配色' : `${custom} 项自定义配色`}`;
        screen.text(innerX, noteY, note, { fg: theme.dim }, { maxWidth: Math.max(4, innerRight - innerX) });
    }
}
/** 弹层 */
export function drawModal(app, screen, area, theme) {
    const modal = app.modal;
    if (modal === null) {
        return;
    }
    // 无背景色可依赖：先把内容区抹干净，弹层才不会被底下的线框穿透
    screen.fillRect(area.x, area.y, area.w, area.h, { fg: theme.text, bg: theme.base });
    if (modal.kind === 'filter' || modal.kind === 'input') {
        const width = Math.min(80, area.w - 6);
        const height = 7;
        const rect = drawModalFrame(app, screen, area, width, height, theme, modal.title);
        screen.text(rect.x + 2, rect.y + 1, modal.hint, { fg: theme.muted }, { maxWidth: width - 4 });
        const fieldX = rect.x + 2;
        const fieldY = rect.y + 2;
        const fieldW = width - 4;
        screen.hline(fieldX, fieldY + 1, fieldW, { fg: theme.border });
        const chars = Array.from(modal.value);
        const cursor = Math.min(modal.cursor, chars.length);
        const available = Math.max(4, fieldW - 2);
        let start = 0;
        while (start < cursor && strWidth(chars.slice(start, cursor).join('')) > available - 1) {
            start += 1;
        }
        const display = clipText(chars.slice(start).join(''), available, '');
        screen.text(fieldX + 1, fieldY, display, { fg: theme.text }, { maxWidth: available });
        if (display === '') {
            screen.text(fieldX + 1, fieldY, '输入…', { fg: theme.dim }, { maxWidth: available });
        }
        const prefixWidth = strWidth(chars.slice(start, cursor).join(''));
        app.cursor = { x: fieldX + 1 + prefixWidth, y: fieldY };
        screen.hit(fieldX + 1, fieldY, fieldW - 2, 1, (event) => {
            const column = Math.max(0, event.x - 1 - (fieldX + 1));
            let index = start;
            let used = 0;
            while (index < chars.length) {
                const charWidthValue = strWidth(chars[index] ?? '');
                if (used + charWidthValue > column) {
                    break;
                }
                used += charWidthValue;
                index += 1;
            }
            app.setInputCursor(index);
        }, 'modal');
        if (modal.error !== '') {
            screen.text(rect.x + 2, rect.y + 4, modal.error, { fg: theme.bad, bold: true }, { maxWidth: width - 4 });
        }
        const hints = modalHints(modal);
        let hx = rect.x + 2;
        for (const [key, label] of hints) {
            hx = screen.text(hx, rect.y + height - 2, key, { fg: theme.accent, bold: true });
            hx = screen.text(hx + 1, rect.y + height - 2, label, { fg: theme.muted }) + 3;
        }
        return;
    }
    if (modal.kind === 'help' || modal.kind === 'doctor' || modal.kind === 'output') {
        const width = Math.min(92, area.w - 4);
        const height = Math.min(Math.max(9, area.h - 2), 26);
        const rect = drawModalFrame(app, screen, area, width, height, theme, modal.title);
        const innerX = rect.x + 2;
        const innerW = width - 4;
        const innerH = height - 3;
        const lines = modal.lines;
        const top = Math.max(0, Math.min(modal.top, Math.max(0, lines.length - innerH)));
        for (let offset = 0; offset < innerH; offset += 1) {
            const line = lines[top + offset];
            if (line === undefined) {
                break;
            }
            const marker = line.startsWith('#') ? '§' : line.startsWith('!') ? '✗' : line.startsWith('*') ? '!' : ' ';
            const style = line.startsWith('!')
                ? { fg: theme.bad }
                : line.startsWith('*')
                    ? { fg: theme.warn }
                    : line.startsWith('#')
                        ? { fg: theme.title, bold: true }
                        : line.startsWith('|')
                            ? { fg: theme.accent2 }
                            : { fg: theme.text };
            const body = line.replace(/^[!*#|]/, '');
            screen.text(innerX, rect.y + 1 + offset, marker === ' ' ? ` ${body}` : `${marker}${body}`, style, {
                maxWidth: innerW });
        }
        if (lines.length > innerH) {
            const bar = ` ${top + 1}-${Math.min(top + innerH, lines.length)}/${lines.length} `;
            screen.text(rect.x + width - 2 - strWidth(bar) - 6, rect.y + height - 1, bar, { fg: theme.dim }, {
                maxWidth: strWidth(bar) });
        }
        return;
    }
    // 列表型弹层：arch / packages
    const rows = modal.rows;
    const width = Math.min(84, area.w - 6);
    const height = Math.min(Math.max(7, rows.length + 5), area.h - 2);
    const rect = drawModalFrame(app, screen, area, width, height, theme, modal.title);
    const innerX = rect.x + 2;
    const innerW = width - 4;
    const innerH = height - 3;
    const top = Math.max(0, Math.min(modal.top, Math.max(0, rows.length - innerH)));
    if (rows.length === 0) {
        screen.text(innerX, rect.y + 1, '（没有可选项）', { fg: theme.muted }, { maxWidth: innerW });
    }
    for (let offset = 0; offset < innerH; offset += 1) {
        const index = top + offset;
        const row = rows[index];
        if (row === undefined) {
            break;
        }
        const selected = index === modal.index;
        const style = selected ? { fg: theme.accent, bold: true } : { fg: theme.text };
        const ly = rect.y + 1 + offset;
        if (selected) {
            screen.text(rect.x + 1, ly, '▌', { fg: theme.accent, bold: true }, { maxWidth: 1 });
        }
        const badge = row.badge !== undefined && row.badge !== '' ? `[${row.badge}]` : '';
        const badgeWidth = strWidth(badge);
        const labelWidth = Math.max(8, innerW - badgeWidth - (row.hint !== undefined ? 22 : 2));
        screen.text(innerX + 1, ly, row.label, { ...style, bold: selected }, { maxWidth: labelWidth });
        if (badge !== '') {
            screen.text(rect.x + width - 3 - badgeWidth, ly, badge, {
                fg: selected ? theme.muted : theme.dim }, { maxWidth: badgeWidth });
        }
        if (row.hint !== undefined && row.hint !== '') {
            const hintWidth = Math.max(0, innerW - labelWidth - badgeWidth - 6);
            if (hintWidth > 5) {
                screen.text(innerX + 1 + labelWidth + 2, ly, shortPath(row.hint, hintWidth), { fg: theme.dim }, {
                    maxWidth: hintWidth });
            }
        }
        screen.hit(rect.x + 1, ly, width - 2, 1, () => app.clickModalRow(index), 'modal');
    }
}
/** 帮助文本（供 app 打开帮助弹层时使用） */
export function helpLines() {
    return [
        '#工具列表',
        '  ↑ ↓ / j k        上下移动',
        '  PgUp PgDn        翻页',
        '  Home / End       跳到首尾',
        '  1 - 9            选中对应编号的工具',
        '  Enter            执行工具 / 进入子菜单',
        '  f                收藏 / 取消收藏（★）',
        '  /                即时过滤（输入即生效）',
        '',
        '#菜单与视图',
        '  Tab / Shift+Tab  在视图间切换：主菜单 → 收藏 → 最近使用 → 设置',
        '  Esc              返回上级（有过滤时先清过滤）',
        '  b 或 ←           返回上级菜单',
        '  m 或 →           回到主菜单',
        '  左栏「视图」      主菜单 / 收藏 / 最近使用 / 设置',
        '',
        '#工具箱',
        '  a                指定架构后执行',
        '  s                设置页（手动选架构 / 主题 / 详情框）',
        '  p                切换 / 添加 / 移除工具包',
        '  d                环境自检',
        '  o                上次执行的完整输出',
        '  r                重新读取配置',
        '  t                深色 / 浅色主题',
        '',
        '#鼠标',
        '  点左栏            切视图 / 打开设置 / 打开工具包',
        '  点工具行          选中，再点一次执行',
        '  点 ★ 列           收藏 / 取消收藏',
        '  滚轮              滚动列表',
        '',
        '#退出',
        '  q / Ctrl+C       退出',
    ];
}
/** 单行进度/信息（供 doctor 弹层排版用） */
export function doctorLines(title, checks) {
    const lines = [`#${title}`, ''];
    for (const check of checks) {
        const marker = check.level === 'ok' ? '[ok]' : check.level === 'warn' ? '[!] ' : '[x] ';
        lines.push(`${check.level === 'fail' ? '!' : check.level === 'warn' ? '*' : ' '}${marker} ${check.name}`);
        lines.push(`        ${check.detail}`);
    }
    return lines;
}
/** 用命令输出构造弹层文本 */
export function outputLines(run) {
    if (run === null) {
        return ['#还没有执行记录', '', '执行任意工具后，这里会显示它的完整输出。'];
    }
    return [
        `#${run.name}  ·  ${run.arch}  ·  退出码 ${run.code ?? '-'}`,
        '',
        ...run.tail.map((line) => `|${line}`),
    ];
}
/** 菜单行 -> 文本（测试与快照辅助） */
export { wrapText };
