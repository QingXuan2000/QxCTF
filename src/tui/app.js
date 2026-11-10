/**
 * QxCTF TUI 控制器
 *
 * 工具箱取向的设计：工具列表是主视图，菜单只是分类；
 * 收藏（★）与最近使用是两个虚拟视图；执行结果只留存在 toast 与历史里，
 * 首页不显示上次执行结果（按 o 打开只读弹层查看）。
 *
 * 渲染交给 chrome.js / views.js，本文件只负责状态与输入。
 */
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import readline from 'node:readline';
import { runDoctor } from '../core/doctor.js';
import { describeError } from '../core/errors.js';
import { formatPlan, planExecution, runPlanTee } from '../core/executor.js';
import { packageSummary } from '../core/packages.js';
import { loadFavorites, loadHistory, pushHistory, recentMap, toggleFavorite, toolKey } from '../core/store.js';
import { updateSettingsFile } from '../core/config.js';
import { drawFooter, drawHeader, drawSidebar, modalHints } from './chrome.js';
import { COLOR_ITEMS, FAVORITES_VIEW, RECENT_VIEW, SETTINGS_FLAT, SETTINGS_SECTIONS, SETTINGS_TOTAL, SETTINGS_VIEW, SIDEBAR_ENTRIES, badgeOf, breadcrumb, clamp, geometryFor, isListable, navEntries, scrollTop } from './model.js';
import { doctorLines, drawModal, drawToolsView, helpLines, outputLines } from './views.js';
import { MOUSE_DISABLE, MOUSE_ENABLE, createInputDecoder, parseFocus, parseMouse } from '../ui/input.js';
import { Screen } from '../ui/screen.js';
import { detectColorMode, resolveTheme, sanitizeColors } from '../ui/theme.js';
const HINTS = [
    ['↑↓', '移动'],
    ['Enter', '执行'],
    ['Tab', '切视图'],
    ['Esc', '返回'],
    ['/', '过滤'],
    ['f', '收藏'],
    ['p', '工具包'],
    ['1-9', '选号'],
];
const HINTS_FILTER = [
    ['输入', '即时过滤'],
    ['Enter', '保留'],
    ['Esc', '清空'],
];
const HINTS_SETTINGS = [
    ['↑↓', '选择'],
    ['Enter', '切换'],
    ['Tab', '切视图'],
    ['s / Esc', '返回'],
];
/** 清屏并把光标移回左上角：工具日志从干净的一屏开始 */
export const CLEAR_SCREEN = '\x1b[2J\x1b[H';
/** 执行工具前打印的横幅（先清屏） */
export function runHandoffStart(item, plan) {
    return `${CLEAR_SCREEN}[QxCTF] ${item.name}\n      ${formatPlan(plan)}\n\n`;
}
/** 执行结束后的一行提示 */
export function runHandoffEnd(code) {
    return `\n[QxCTF] 退出码 ${code ?? '-'} · 按任意键返回\n`;
}
export class QxCtfTui {
    bootstrap;
    theme;
    themeName;
    stack = ['main'];
    menuId = 'main';
    title = 'main';
    crumbs = 'main';
    rows = [];
    totalRows = 0;
    index = 0;
    top = 0;
    filter = '';
    filtering = false;
    modal = null;
    toast = null;
    lastRun = null;
    favoriteCount = 0;
    cursor = null;
    busy = false;
    /** 首页是否显示「选项详情」框（设置页可切换） */
    showDetail = true;
    /** 设置页当前选中项 */
    settingsIndex = 0;
    /** 本帧的时间戳（由 buildScreen 刷新，供渲染层做时间判断） */
    now = Date.now();
    loader;
    execute;
    stdin;
    stdout;
    size;
    clock;
    colorMode;
    favorites = new Set();
    history = [];
    hits = [];
    clickArm = -1;
    toastTimer = null;
    renderTimer = null;
    tickTimer = null;
    decoder = null;
    inputStream = null;
    keyHandler = null;
    stdinHandler = null;
    resizeHandler = null;
    signalHandler = null;
    flushTimer = null;
    tuiActive = false;
    closing = false;
    suspended = false;
    resolveExit = null;
    pendingRun = null;
    pendingItem = null;
    sizeOverride = null;
    constructor(options) {
        this.bootstrap = options.initial;
        this.loader = options.loader;
        this.stdin = options.stdin ?? process.stdin;
        this.stdout = options.stdout ?? process.stdout;
        this.size = options.size ?? null;
        this.clock = options.now ?? (() => Date.now());
        this.themeName = options.themeName ?? options.initial?.settings.themeName ?? 'dark';
        // 自定义配色：settings.json 的 colors.<theme>，缺省时用内置配色
        this.theme = resolveTheme(this.themeName, options.initial?.settings.colors?.[this.themeName]);
        this.colorMode = detectColorMode(options.initial?.settings.colorMode ?? 'auto');
        this.execute = options.execute ?? ((plan) => this.defaultExecute(plan));
        this.reloadStore();
        this.menuId = 'main';
        this.stack = ['main'];
        this.refreshRows();
        if (options.initial === null) {
            this.openInput('首次运行', '请输入工具包目录（含 config/menu.json 或 menu.json）');
        }
    }
    // ================= 数据 =================
    reloadStore() {
        const root = this.bootstrap?.packageRoot ?? '';
        const prefix = root === '' ? '' : `${root}::`;
        const all = loadFavorites();
        this.favorites = new Set(prefix === '' ? [] : all.filter((key) => key.startsWith(prefix)));
        this.history = loadHistory();
        this.favoriteCount = this.favorites.size;
    }
    root() {
        return this.bootstrap?.packageRoot ?? '';
    }
    keyOf(menuId, item) {
        return toolKey(this.root(), menuId, item.id);
    }
    recentByKey() {
        const prefix = this.root() === '' ? '' : `${this.root()}::`;
        const scoped = this.history.filter((entry) => prefix === '' || entry.key.startsWith(prefix));
        return recentMap(scoped);
    }
    /** 把 `root::menu::id` 拆开 */
    parseKey(key) {
        const index = key.lastIndexOf('::');
        if (index < 0) {
            return null;
        }
        const id = Number.parseInt(key.slice(index + 2), 10);
        const before = key.slice(0, index);
        const sepIndex = before.lastIndexOf('::');
        if (sepIndex < 0 || Number.isNaN(id)) {
            return null;
        }
        return { menuId: before.slice(sepIndex + 2), id };
    }
    buildRow(menuId, item, recent) {
        const key = this.keyOf(menuId, item);
        let plan = null;
        let planError = null;
        if (item.type === 'executable' && this.bootstrap !== null) {
            try {
                plan = planExecution(item, { packageRoot: this.bootstrap.packageRoot, detectedArch: this.bootstrap.arch });
            }
            catch (error) {
                planError = describeError(error);
            }
        }
        return {
            key,
            item,
            menuId,
            plan,
            planError,
            favorite: this.favorites.has(key),
            recentAt: recent.get(key) ?? 0 };
    }
    /** 重算当前视图的行 */
    refreshRows() {
        const bootstrap = this.bootstrap;
        const recent = this.recentByKey();
        const needle = this.filter.trim().toLowerCase();
        if (bootstrap === null) {
            this.rows = [];
            this.totalRows = 0;
            this.title = '未配置';
            this.crumbs = '';
            return;
        }
        if (this.menuId === FAVORITES_VIEW) {
            const rows = [];
            for (const key of this.favorites) {
                const parsed = this.parseKey(key);
                if (parsed === null) {
                    continue;
                }
                const item = bootstrap.config.menu[parsed.menuId]?.items.find((candidate) => candidate.id === parsed.id);
                if (item === undefined || !isListable(item)) {
                    continue;
                }
                const row = this.buildRow(parsed.menuId, item, recent);
                if (needle !== '' && !row.item.name.toLowerCase().includes(needle)) {
                    continue;
                }
                rows.push(row);
            }
            this.rows = rows;
            this.totalRows = rows.length;
            this.title = '收藏';
            this.crumbs = `${this.favoriteCount} 个常用工具`;
            this.clampIndex();
            return;
        }
        if (this.menuId === RECENT_VIEW) {
            const seen = new Set();
            const rows = [];
            for (const entry of [...this.history].sort((a, b) => b.at - a.at)) {
                if (seen.has(entry.key)) {
                    continue;
                }
                const parsed = this.parseKey(entry.key);
                if (parsed === null) {
                    continue;
                }
                const item = bootstrap.config.menu[parsed.menuId]?.items.find((candidate) => candidate.id === parsed.id);
                if (item === undefined || !isListable(item)) {
                    continue;
                }
                seen.add(entry.key);
                const row = this.buildRow(parsed.menuId, item, recent);
                if (needle !== '' && !row.item.name.toLowerCase().includes(needle)) {
                    continue;
                }
                rows.push(row);
                if (rows.length >= 40) {
                    break;
                }
            }
            this.rows = rows;
            this.totalRows = rows.length;
            this.title = '最近使用';
            this.crumbs = '按执行时间倒序';
            this.clampIndex();
            return;
        }
        if (this.menuId === SETTINGS_VIEW) {
            this.rows = [];
            this.totalRows = 0;
            this.index = 0;
            this.top = 0;
            this.settingsIndex = Math.min(this.settingsIndex, SETTINGS_TOTAL - 1);
            this.title = '设置';
            this.crumbs = '设置';
            return;
        }
        const node = bootstrap.config.menu[this.menuId];
        // back / main 这类导航项由面包屑与快捷键承担，不再占用列表位置
        const items = (node?.items ?? []).filter((item) => isListable(item));
        const visible = needle === ''
            ? items
            : items.filter((item) => item.name.toLowerCase().includes(needle)
                || (item.desc ?? '').toLowerCase().includes(needle)
                || String(item.id) === needle);
        this.rows = visible.map((item) => this.buildRow(this.menuId, item, recent));
        this.totalRows = items.length;
        const title = (node?.title ?? '').replace(/\n/g, ' ').trim();
        this.title = title === '' ? this.menuId : title;
        this.crumbs = breadcrumb(bootstrap.config, this.stack);
        this.clampIndex();
    }
    clampIndex() {
        if (this.index >= this.rows.length) {
            this.index = Math.max(0, this.rows.length - 1);
        }
        this.top = scrollTop(this.index, this.top, Math.max(1, this.rows.length), this.rows.length);
    }
    /** 设置页第 index 个条目（分区摊平后）：{key, label, hint, value} */
    settingsRowAt(index) {
        const entry = SETTINGS_FLAT[index] ?? SETTINGS_FLAT[0];
        return { ...entry, value: this.settingsValue(entry.key) };
    }
    /**
     * 设置页的渲染行：分区标题 + 条目
     *
     * 返回 `{ kind: 'header', label }` 或 `{ kind: 'item', index, label, hint, value }`，
     * 选择下标只落在 item 上，标题行不参与移动。
     */
    settingsLayoutRows() {
        const rows = [];
        let index = 0;
        for (const section of SETTINGS_SECTIONS) {
            rows.push({ kind: 'header', label: section.title });
            for (const entry of section.items) {
                rows.push({ kind: 'item', index, ...entry, value: this.settingsValue(entry.key) });
                index += 1;
            }
        }
        return rows;
    }
    /** 设置页当前选中的条目：行为项 → 配色项 → 重置 */
    get settingsItem() {
        return this.settingsRowAt(this.settingsIndex);
    }
    /** 设置项当前值（渲染与切换共用一处真值） */
    settingsValue(key) {
        if (key === 'archPicker') {
            return this.bootstrap?.settings.archPicker === true ? '开' : '关';
        }
        if (key === 'theme') {
            return this.themeName === 'dark' ? '深色' : '浅色';
        }
        if (key === 'detail') {
            return this.showDetail ? '显示' : '隐藏';
        }
        if (key === 'resetColors') {
            return this.customColorCount() > 0 ? `${this.customColorCount()} 项自定义` : '默认';
        }
        // 配色项：显示当前生效的色值
        return this.theme[key] ?? '';
    }
    /** 当前主题下被自定义覆盖的色位数量 */
    customColorCount() {
        const overrides = this.colorOverrides(this.themeName);
        return Object.keys(sanitizeColors(overrides)).length;
    }
    /** 读某个主题的自定义配色 */
    colorOverrides(name = this.themeName) {
        return this.bootstrap?.settings.colors?.[name] ?? {};
    }
    /** 重建主题（内置配色 + 当前主题下的自定义覆盖） */
    applyTheme() {
        this.theme = resolveTheme(this.themeName, this.colorOverrides());
    }
    moveSettings(delta) {
        const next = clamp(this.settingsIndex + delta, 0, SETTINGS_TOTAL - 1);
        if (next !== this.settingsIndex) {
            this.settingsIndex = next;
            this.renderNow();
        }
    }
    /** 切换设置项并立即生效；架构开关与配色都写回 settings.json */
    toggleSettingsItem(index = this.settingsIndex) {
        this.settingsIndex = index;
        const entry = this.settingsItem;
        if (entry.key === 'archPicker' && this.bootstrap !== null) {
            const next = this.bootstrap.settings.archPicker !== true;
            this.bootstrap.settings.archPicker = next;
            try {
                updateSettingsFile(this.bootstrap.configDir, { archPicker: next });
                this.showToast(next ? '执行前会先选架构' : '执行前不再询问架构', 'ok', 1800);
            }
            catch (error) {
                this.showToast(describeError(error), 'err');
            }
        }
        else if (entry.key === 'theme') {
            this.themeName = this.themeName === 'dark' ? 'light' : 'dark';
            this.applyTheme();
        }
        else if (entry.key === 'detail') {
            this.showDetail = !this.showDetail;
        }
        else if (entry.key === 'resetColors') {
            this.resetColors();
        }
        else if (COLOR_ITEMS.some((item) => item.key === entry.key)) {
            this.openColorInput(entry);
            return;
        }
        this.renderNow();
    }
    /** 打开配色输入框（预填当前色值） */
    openColorInput(entry) {
        if (this.bootstrap === null) {
            return;
        }
        this.openInput(entry.label, `${entry.hint} · 输入 #rrggbb 后回车保存，Esc 取消`);
        if (this.modal !== null) {
            this.modal.purpose = 'color';
            this.modal.colorKey = entry.key;
            this.modal.value = this.theme[entry.key] ?? '';
            this.modal.cursor = this.modal.value.length;
            this.renderNow();
        }
    }
    /** 写回自定义配色（空值 = 删除该色位的覆盖） */
    saveColor(key, value) {
        if (this.bootstrap === null) {
            return;
        }
        const themeKey = this.themeName;
        const current = { ...this.colorOverrides(themeKey) };
        const trimmed = value.trim();
        if (trimmed === '') {
            delete current[key];
        }
        else {
            if (!/^#[0-9a-f]{6}$/i.test(trimmed)) {
                if (this.modal !== null) {
                    this.modal.error = '颜色格式应为 #rrggbb';
                    this.renderNow();
                }
                return;
            }
            current[key] = trimmed.toLowerCase();
        }
        const colors = { ...(this.bootstrap.settings.colors ?? {}), [themeKey]: current };
        this.persistColors(colors);
        this.modal = null;
        this.applyTheme();
        this.showToast(trimmed === '' ? `已恢复默认 ${key}` : `${key} → ${trimmed}`, 'ok', 1800);
        this.renderNow();
    }
    /** 清掉当前主题的自定义配色 */
    resetColors() {
        if (this.bootstrap === null) {
            return;
        }
        const colors = { ...(this.bootstrap.settings.colors ?? {}), [this.themeName]: {} };
        this.persistColors(colors);
        this.applyTheme();
        this.showToast('已恢复默认配色', 'ok', 1800);
        this.renderNow();
    }
    /** 写回 settings.json 的 colors，空主题对象直接省掉（全默认时整个键也去掉） */
    persistColors(colors) {
        if (this.bootstrap === null) {
            return;
        }
        const cleaned = {};
        for (const name of ['dark', 'light']) {
            const entries = colors[name];
            if (entries !== undefined && Object.keys(sanitizeColors(entries)).length > 0) {
                cleaned[name] = sanitizeColors(entries);
            }
        }
        try {
            updateSettingsFile(this.bootstrap.configDir, {
                colors: Object.keys(cleaned).length === 0 ? undefined : cleaned,
            });
            this.bootstrap.settings.colors = cleaned;
        }
        catch (error) {
            this.showToast(describeError(error), 'err');
        }
    }
    stackFor(menuId) {
        const config = this.bootstrap?.config;
        if (config === undefined || config.menu[menuId] === undefined) {
            return ['main'];
        }
        const chain = [menuId];
        let current = config.menu[menuId];
        let guard = 0;
        while (current?.parent !== undefined && guard < 32) {
            const parent = current.parent;
            if (config.menu[parent] === undefined || chain.includes(parent)) {
                break;
            }
            chain.unshift(parent);
            current = config.menu[parent];
            guard += 1;
        }
        if (chain[0] !== 'main' && config.menu['main'] !== undefined) {
            chain.unshift('main');
        }
        return chain;
    }
    // ================= 交互回调 =================
    setMenu(menuId) {
        if (this.bootstrap === null) {
            return;
        }
        const virtual = menuId === FAVORITES_VIEW || menuId === RECENT_VIEW || menuId === SETTINGS_VIEW;
        if (!virtual && this.bootstrap.config.menu[menuId] === undefined) {
            this.showToast(`菜单不存在：${menuId}`, 'err');
            return;
        }
        if (this.menuId === menuId) {
            return;
        }
        this.menuId = menuId;
        this.stack = virtual ? ['main'] : this.stackFor(menuId);
        this.index = 0;
        this.top = 0;
        this.filter = '';
        this.filtering = false;
        this.refreshRows();
        this.renderNow();
    }
    clickNav(menuId) {
        // 左栏任何时候都能用：有弹层也先关掉再跳，避免「点哪都回不去」
        if (this.modal !== null) {
            this.modal = null;
        }
        this.setMenu(menuId);
    }
    clickRow(index) {
        if (this.index === index && this.clickArm === index) {
            this.activate(index);
            return;
        }
        this.index = index;
        this.clickArm = index;
        this.renderNow();
    }
    clickModalRow(index) {
        if (this.modal === null) {
            return;
        }
        if (this.modal.index === index) {
            this.pickModal(index);
            return;
        }
        this.modal.index = index;
        this.renderNow();
    }
    scrollList(delta) {
        this.move(delta);
    }
    toggleFavoriteAt(index) {
        const row = this.rows[index];
        if (row === undefined) {
            return;
        }
        try {
            const next = toggleFavorite(row.key);
            const prefix = `${this.root()}::`;
            this.favorites = new Set(next.filter((key) => key.startsWith(prefix)));
            this.favoriteCount = this.favorites.size;
            this.refreshRows();
            this.showToast(row.favorite ? `已取消收藏 ${row.item.name}` : `已收藏 ${row.item.name}`, 'ok', 1800);
        }
        catch (error) {
            this.showToast(describeError(error), 'err');
        }
    }
    enterSelected() {
        this.activate(this.index);
    }
    requestQuit() {
        this.quit();
    }
    reload() {
        if (this.bootstrap === null) {
            return;
        }
        try {
            this.bootstrap = this.loader.load(this.bootstrap.configDir);
            this.reloadStore();
            this.refreshRows();
            this.showToast('配置已重载', 'ok');
        }
        catch (error) {
            this.showToast(describeError(error), 'err');
        }
    }
    enterFilter() {
        this.filtering = true;
        this.filter = '';
        this.refreshRows();
        this.renderNow();
    }
    toggleFilterInput() {
        this.filtering = !this.filtering;
        this.renderNow();
    }
    setInputCursor(index) {
        if (this.modal === null) {
            return;
        }
        this.modal.cursor = clamp(index, 0, Array.from(this.modal.value).length);
        this.renderNow();
    }
    submitInput() {
        if (this.modal === null) {
            return;
        }
        // 配色输入：允许清空（= 恢复该色位默认值）
        if (this.modal.purpose === 'color') {
            this.saveColor(this.modal.colorKey ?? '', this.modal.value);
            return;
        }
        const value = this.modal.value.trim();
        if (value === '') {
            this.modal.error = '目录不能为空';
            this.renderNow();
            return;
        }
        try {
            // 一律走 switchTo：它会解析目录、持久化 config_path.json 并把工具包
            // 注册进 tool_packages.json。首次启动也必须注册，否则 p 面板里看不到。
            const next = this.loader.switchTo(value);
            this.bootstrap = next;
            this.menuId = 'main';
            this.stack = ['main'];
            this.index = 0;
            this.top = 0;
            this.filter = '';
            this.filtering = false;
            this.modal = null;
            this.reloadStore();
            this.refreshRows();
            const registered = next.packages.some((record) => record.path === next.packageRoot);
            this.showToast(registered
                ? `已载入工具包 ${next.packageInfo.name}（已加入工具包列表）`
                : `已载入工具包 ${next.packageInfo.name}`, 'ok');
        }
        catch (error) {
            if (this.modal !== null) {
                this.modal.error = describeError(error);
                this.renderNow();
            }
        }
    }
    cancelModal() {
        this.modal = null;
        this.renderNow();
    }
    // ================= 弹层 =================
    openModal(modal) {
        this.modal = modal;
        this.clickArm = -1;
        this.renderNow();
    }
    openHelp() {
        this.openModal({
            kind: 'help',
            title: '快捷键',
            rows: [],
            index: 0,
            top: 0,
            value: '',
            cursor: 0,
            hint: '',
            error: '',
            lines: helpLines() });
    }
    openDoctor() {
        if (this.bootstrap === null) {
            this.openInput('首次运行', '请先指定工具包目录');
            return;
        }
        const report = runDoctor(this.bootstrap.configDir);
        this.openModal({
            kind: 'doctor',
            title: `环境自检 · ${report.ok ? '通过' : '有失败项'}`,
            rows: [],
            index: 0,
            top: 0,
            value: '',
            cursor: 0,
            hint: '',
            error: '',
            lines: doctorLines(this.bootstrap.configDir, report.checks) });
    }
    openOutput() {
        this.openModal({
            kind: 'output',
            title: '执行输出',
            rows: [],
            index: 0,
            top: 0,
            value: '',
            cursor: 0,
            hint: '',
            error: '',
            lines: outputLines(this.lastRun) });
    }
    openArch(item = null) {
        if (this.bootstrap === null) {
            return;
        }
        const options = this.bootstrap.archOptions;
        if (options.length === 0) {
            this.showToast('没有按架构分发的命令，无需选择架构', 'warn');
            return;
        }
        const rows = options.map((option) => ({ label: option.display, badge: option.value }));
        this.pendingItem = item;
        this.openModal({
            kind: 'arch',
            title: '选择目标架构',
            rows,
            index: 0,
            top: 0,
            value: '',
            cursor: 0,
            hint: '为选中工具指定目标架构',
            error: '',
            lines: [] });
    }
    openPackages() {
        if (this.bootstrap === null) {
            return;
        }
        const rows = this.bootstrap.packages.map((record) => {
            const summary = packageSummary(record);
            return {
                label: summary.name,
                badge: summary.alive ? summary.version : '失效',
                hint: summary.configDir };
        });
        this.openModal({
            kind: 'packages',
            title: `工具包 · 共 ${rows.length} 个`,
            rows,
            index: 0,
            top: 0,
            value: '',
            cursor: 0,
            hint: 'a 添加路径，d 移除，Enter 切换',
            error: '',
            lines: [] });
    }
    openFilter() {
        this.enterFilter();
    }
    openInput(title, hint) {
        this.openModal({
            kind: 'input',
            title,
            rows: [],
            index: 0,
            top: 0,
            value: '',
            cursor: 0,
            hint,
            error: '',
            lines: [] });
    }
    pickModal(index) {
        const modal = this.modal;
        if (modal === null) {
            return;
        }
        if (modal.kind === 'arch') {
            const option = this.bootstrap?.archOptions[index];
            const target = this.pendingItem ?? this.rows[this.index]?.item ?? null;
            this.modal = null;
            this.pendingItem = null;
            if (option !== undefined && target !== null) {
                void this.runTool(target, option.value);
            }
            return;
        }
        if (modal.kind === 'packages') {
            const record = this.bootstrap?.packages[index];
            if (record === undefined) {
                return;
            }
            try {
                const next = this.loader.switchTo(record.path);
                this.bootstrap = next;
                this.menuId = 'main';
                this.stack = ['main'];
                this.index = 0;
                this.filter = '';
                this.modal = null;
                this.reloadStore();
                this.refreshRows();
                this.showToast(`已切换到 ${next.packageInfo.name}`, 'ok');
            }
            catch (error) {
                modal.error = describeError(error);
                this.renderNow();
            }
            return;
        }
        if (modal.kind === 'input') {
            this.submitInput();
        }
    }
    // ================= 导航 =================
    move(delta) {
        if (this.rows.length === 0) {
            return;
        }
        this.index = clamp(this.index + delta, 0, this.rows.length - 1);
        this.top = scrollTop(this.index, this.top, Math.max(1, this.rows.length), this.rows.length);
        this.clickArm = -1;
        this.renderNow();
    }
    setIndex(index) {
        if (this.rows.length === 0) {
            return;
        }
        this.index = clamp(index, 0, this.rows.length - 1);
        this.clickArm = -1;
        this.renderNow();
    }
    back() {
        if (this.menuId === FAVORITES_VIEW || this.menuId === RECENT_VIEW || this.stack.length <= 1) {
            this.main();
            return;
        }
        this.stack = this.stack.slice(0, -1);
        const parent = this.stack[this.stack.length - 1] ?? 'main';
        this.menuId = parent;
        this.index = 0;
        this.top = 0;
        this.filter = '';
        this.refreshRows();
        this.renderNow();
    }
    main() {
        if (this.menuId === 'main' && this.stack.length === 1) {
            return;
        }
        this.menuId = 'main';
        this.stack = ['main'];
        this.index = 0;
        this.top = 0;
        this.filter = '';
        this.refreshRows();
        this.renderNow();
    }
    /** Tab / Shift+Tab：在左栏「视图」之间循环（主菜单 → 收藏 → 最近使用 → 设置） */
    cycleView(delta) {
        const entries = SIDEBAR_ENTRIES;
        const current = entries.findIndex((entry) => entry.id === this.menuId);
        const next = (Math.max(0, current) + delta + entries.length) % entries.length;
        const target = entries[next];
        if (target !== undefined) {
            this.setMenu(target.id);
        }
    }
    activate(index) {
        const row = this.rows[index];
        if (row === undefined) {
            return;
        }
        const item = row.item;
        if (item.type === 'executable') {
            if (this.bootstrap !== null && this.bootstrap.settings.archPicker && this.bootstrap.archOptions.length > 0) {
                this.openArch(item);
                return;
            }
            void this.runTool(item, null);
            return;
        }
        if (item.type === 'submenu' && item.submenu !== undefined) {
            this.setMenu(item.submenu);
            return;
        }
        if (item.type === 'back') {
            this.back();
            return;
        }
        this.main();
    }
    // ================= 执行 =================
    runTool(item, arch) {
        if (this.bootstrap === null) {
            return Promise.resolve();
        }
        let plan;
        try {
            plan = planExecution(item, {
                packageRoot: this.bootstrap.packageRoot,
                preferredArch: arch,
                detectedArch: this.bootstrap.arch });
        }
        catch (error) {
            this.showToast(describeError(error), 'err');
            return Promise.resolve();
        }
        const startedAt = this.clock();
        const key = this.keyOf(this.menuId === FAVORITES_VIEW || this.menuId === RECENT_VIEW
            ? this.rows[this.index]?.menuId ?? this.menuId
            : this.menuId, item);
        this.busy = true;
        this.lastRun = {
            name: item.name,
            command: plan.command,
            arch: plan.arch,
            code: null,
            ms: 0,
            at: startedAt,
            tail: [] };
        this.renderNow();
        const task = this.execute(plan)
            .then((result) => {
            const run = this.lastRun;
            if (run === null) {
                return;
            }
            run.code = result.code;
            run.ms = Math.max(0, this.clock() - startedAt);
            run.tail = result.tail;
            try {
                this.history = pushHistory({
                    key,
                    name: item.name,
                    command: plan.command,
                    arch: plan.arch,
                    code: result.code,
                    ms: run.ms,
                    at: this.clock(),
                    tail: result.tail });
            }
            catch {
                // 历史写不进去不影响执行结果展示
            }
            const ok = result.code === 0;
            this.showToast(ok ? `${item.name} · 退出码 0` : `${item.name} · 退出码 ${result.code ?? '-'}`, ok ? 'ok' : result.code === null ? 'warn' : 'err');
        })
            .catch((error) => {
            const run = this.lastRun;
            if (run !== null) {
                run.code = null;
                run.ms = Math.max(0, this.clock() - startedAt);
                run.tail = [...run.tail, describeError(error)];
            }
            this.showToast(describeError(error), 'err');
        })
            .finally(() => {
            this.busy = false;
            this.pendingRun = null;
            this.renderNow();
        });
        this.pendingRun = task;
        return task;
    }
    async idle() {
        if (this.pendingRun !== null) {
            await this.pendingRun;
        }
    }
    /** 真实执行：交还终端给子进程，结束后重新接管 */
    async defaultExecute(plan) {
        if (this.tuiActive) {
            this.suspended = true;
            this.stdout.write(`\x1b[0m\x1b[?25h\x1b[?7h${MOUSE_DISABLE}\x1b[?1049l`);
            try {
                this.stdin.setRawMode(false);
            }
            catch {
                // 某些终端不支持
            }
            this.stdout.write(runHandoffStart(plan.item, plan));
        }
        let code = null;
        let signal = null;
        let tail = [];
        try {
            const outcome = await runPlanTee(plan);
            code = outcome.code;
            signal = outcome.signal;
            tail = outcome.tail;
        }
        catch (error) {
            tail = [describeError(error)];
        }
        if (this.tuiActive) {
            this.stdout.write(runHandoffEnd(code));
            await this.waitForKey();
            this.stdout.write(`\x1b[?1049h\x1b[?25l\x1b[?7l${MOUSE_ENABLE}\x1b[2J\x1b[H`);
            try {
                this.stdin.setRawMode(true);
            }
            catch {
                // 忽略
            }
            this.suspended = false;
        }
        return { code, signal, tail };
    }
    waitForKey() {
        return new Promise((resolve) => {
            const stream = this.stdin;
            const done = () => {
                stream.removeListener('data', done);
                resolve();
            };
            stream.on('data', done);
            stream.resume();
        });
    }
    // ================= 提示 =================
    showToast(text, level, ms = 3000) {
        this.toast = { text, level, until: this.clock() + ms };
        if (this.toastTimer !== null) {
            clearTimeout(this.toastTimer);
        }
        this.toastTimer = setTimeout(() => {
            this.toastTimer = null;
            if (this.toast !== null && this.toast.until <= this.clock()) {
                this.toast = null;
                this.renderNow();
            }
        }, ms + 20);
        this.renderNow();
    }
    // ================= 渲染 =================
    terminalSize() {
        return {
            columns: this.sizeOverride?.columns ?? this.size?.columns ?? this.stdout.columns ?? 100,
            rows: this.sizeOverride?.rows ?? this.size?.rows ?? this.stdout.rows ?? 30 };
    }
    buildScreen() {
        const { columns, rows } = this.terminalSize();
        const geometry = geometryFor(columns, rows);
        const screen = new Screen(geometry.width, geometry.height, this.theme.border);
        screen.clear({ fg: this.theme.text, bg: this.theme.base });
        this.cursor = null;
        this.now = this.clock();
        drawHeader(this, screen, geometry.width, this.theme);
        drawSidebar(this, screen, this.theme, geometry);
        drawToolsView(this, screen, geometry.content, this.theme);
        if (this.modal !== null) {
            drawModal(this, screen, geometry.content, this.theme);
        }
        const hints = this.busy
            ? [['', '正在执行…']]
            : this.filtering
                ? HINTS_FILTER
                : this.modal !== null
                    ? modalHints(this.modal)
                    : this.menuId === SETTINGS_VIEW
                        ? HINTS_SETTINGS
                        : HINTS;
        drawFooter(this, screen, geometry.width, geometry.height, this.theme, hints);
        const layer = this.modal !== null ? 'modal' : 'base';
        this.hits = screen.hits.filter((hit) => hit.layer === layer);
        return { screen, geometry };
    }
    snapshot(columns, rows) {
        const previous = this.sizeOverride;
        if (columns !== undefined && rows !== undefined) {
            this.sizeOverride = { columns, rows };
        }
        try {
            return this.buildScreen().screen.toLines();
        }
        finally {
            this.sizeOverride = previous;
        }
    }
    render() {
        if (!this.tuiActive || this.closing || this.suspended) {
            return;
        }
        const { screen } = this.buildScreen();
        const frame = screen.render(this.colorMode);
        let output = `\x1b[H${frame}`;
        if (this.cursor !== null) {
            output += `\x1b[${this.cursor.y + 1};${this.cursor.x + 1}H\x1b[?25h`;
        }
        else {
            output += '\x1b[?25l';
        }
        this.stdout.write(`\x1b[?2026h${output}\x1b[?2026l`);
    }
    renderNow() {
        if (!this.tuiActive || this.closing) {
            return;
        }
        if (this.renderTimer !== null) {
            clearTimeout(this.renderTimer);
            this.renderTimer = null;
        }
        this.render();
    }
    scheduleRender(delay = 30) {
        if (!this.tuiActive || this.closing || this.renderTimer !== null) {
            return;
        }
        this.renderTimer = setTimeout(() => {
            this.renderTimer = null;
            this.render();
        }, delay);
    }
    // ================= 输入 =================
    handleKeypress(sequence, key = {}) {
        if (this.closing || this.suspended) {
            return;
        }
        this.clickArm = -1;
        const char = sequence.length === 1 ? sequence : '';
        if (key.ctrl && key.name === 'c') {
            this.requestQuit();
            return;
        }
        if (this.modal !== null) {
            this.handleModalKey(sequence, key, char);
            return;
        }
        // 设置页：整页接管上下与切换键
        if (this.menuId === SETTINGS_VIEW) {
            if (key.name === 'tab') {
                this.cycleView(key.shift === true ? -1 : 1);
                return;
            }
            if (key.name === 'up' || char === 'k') {
                this.moveSettings(-1);
                return;
            }
            if (key.name === 'down' || char === 'j') {
                this.moveSettings(1);
                return;
            }
            if (key.name === 'return' || char === ' ') {
                this.toggleSettingsItem();
                return;
            }
            if (key.name === 'escape' || char === 's') {
                this.setMenu('main');
                return;
            }
            if (char === 'q') {
                this.requestQuit();
                return;
            }
            return;
        }
        // 过滤输入态：所有可打印字符实时过滤
        if (this.filtering) {
            if (key.name === 'escape') {
                this.filtering = false;
                this.filter = '';
                this.index = 0;
                this.refreshRows();
                this.renderNow();
                return;
            }
            if (key.name === 'return') {
                this.filtering = false;
                this.renderNow();
                return;
            }
            if (key.name === 'backspace' || key.name === 'delete') {
                this.filter = Array.from(this.filter).slice(0, -1).join('');
                this.index = 0;
                this.refreshRows();
                this.renderNow();
                return;
            }
            if (key.name === 'up') {
                this.move(-1);
                return;
            }
            if (key.name === 'down') {
                this.move(1);
                return;
            }
            if (sequence !== '' && !key.ctrl && !key.meta) {
                this.filter += sequence;
                this.index = 0;
                this.refreshRows();
                this.renderNow();
            }
            return;
        }
        if (key.name === 'escape') {
            // 依次让位：先清过滤 → 再清 toast → 最后当「返回上级」用
            if (this.filter !== '') {
                this.filter = '';
                this.index = 0;
                this.refreshRows();
                this.renderNow();
                return;
            }
            if (this.toast !== null) {
                this.toast = null;
                this.renderNow();
                return;
            }
            this.back();
            return;
        }
        if (char >= '1' && char <= '9') {
            const id = Number.parseInt(char, 10);
            const index = this.rows.findIndex((row) => row.item.id === id);
            if (index >= 0) {
                this.setIndex(index);
            }
            return;
        }
        if (key.name === 'tab') {
            this.cycleView(key.shift === true ? -1 : 1);
            return;
        }
        if (char === '/') {
            this.enterFilter();
            return;
        }
        if (char === 'f') {
            this.toggleFavoriteAt(this.index);
            return;
        }
        if (char === '?') {
            this.openHelp();
            return;
        }
        if (char === 'q') {
            this.requestQuit();
            return;
        }
        if (char === 'a') {
            this.openArch(this.rows[this.index]?.item ?? null);
            return;
        }
        if (char === 'p') {
            this.openPackages();
            return;
        }
        if (char === 'd') {
            this.openDoctor();
            return;
        }
        if (char === 's') {
            this.setMenu(SETTINGS_VIEW);
            return;
        }
        if (char === 'o') {
            this.openOutput();
            return;
        }
        if (char === 'r') {
            this.reload();
            return;
        }
        if (char === 't') {
            this.themeName = this.themeName === 'dark' ? 'light' : 'dark';
            this.applyTheme();
            this.showToast(`主题：${this.themeName === 'dark' ? '深色' : '浅色'}`, 'info', 1500);
            return;
        }
        if (char === 'b' || key.name === 'left') {
            this.back();
            return;
        }
        if (char === 'm' || key.name === 'right') {
            this.main();
            return;
        }
        if (char === 'k' || key.name === 'up') {
            this.move(-1);
            return;
        }
        if (char === 'j' || key.name === 'down') {
            this.move(1);
            return;
        }
        if (key.name === 'pageup') {
            this.move(-8);
            return;
        }
        if (key.name === 'pagedown') {
            this.move(8);
            return;
        }
        if (key.name === 'home') {
            this.setIndex(0);
            return;
        }
        if (key.name === 'end') {
            this.setIndex(this.rows.length - 1);
            return;
        }
        if (key.name === 'return') {
            this.enterSelected();
        }
    }
    handleModalKey(sequence, key, char) {
        const modal = this.modal;
        if (modal === null) {
            return;
        }
        if (key.name === 'escape') {
            this.cancelModal();
            return;
        }
        if ((char === 'x' || char === 'X') && modal.kind !== 'input') {
            this.cancelModal();
            return;
        }
        if (modal.kind === 'input') {
            const chars = Array.from(modal.value);
            if (key.name === 'left') {
                modal.cursor = clamp(modal.cursor - 1, 0, chars.length);
                this.scheduleRender(10);
                return;
            }
            if (key.name === 'right') {
                modal.cursor = clamp(modal.cursor + 1, 0, chars.length);
                this.scheduleRender(10);
                return;
            }
            if (key.name === 'home') {
                modal.cursor = 0;
                this.scheduleRender(10);
                return;
            }
            if (key.name === 'end') {
                modal.cursor = chars.length;
                this.scheduleRender(10);
                return;
            }
            if (key.name === 'backspace') {
                if (modal.cursor > 0) {
                    chars.splice(modal.cursor - 1, 1);
                    modal.cursor -= 1;
                    modal.value = chars.join('');
                    modal.error = '';
                }
                this.scheduleRender(10);
                return;
            }
            if (key.name === 'delete') {
                if (modal.cursor < chars.length) {
                    chars.splice(modal.cursor, 1);
                    modal.value = chars.join('');
                    modal.error = '';
                }
                this.scheduleRender(10);
                return;
            }
            if (key.name === 'return') {
                this.submitInput();
                return;
            }
            if (sequence !== '' && !key.ctrl && !key.meta) {
                const printable = Array.from(sequence).filter((ch) => ch >= ' ');
                if (printable.length > 0) {
                    chars.splice(modal.cursor, 0, ...printable);
                    modal.cursor += printable.length;
                    modal.value = chars.join('');
                    modal.error = '';
                    this.scheduleRender(10);
                }
            }
            return;
        }
        const pageSize = 8;
        if (key.name === 'up' || char === 'k') {
            if (modal.rows.length > 0) {
                modal.index = clamp(modal.index - 1, 0, modal.rows.length - 1);
            }
            else {
                modal.top = Math.max(0, modal.top - 1);
            }
            this.scheduleRender(10);
            return;
        }
        if (key.name === 'down' || char === 'j') {
            if (modal.rows.length > 0) {
                modal.index = clamp(modal.index + 1, 0, modal.rows.length - 1);
            }
            else {
                modal.top += 1;
            }
            this.scheduleRender(10);
            return;
        }
        if (key.name === 'pageup') {
            modal.top = Math.max(0, modal.top - pageSize);
            modal.index = Math.max(0, modal.index - pageSize);
            this.scheduleRender(10);
            return;
        }
        if (key.name === 'pagedown') {
            modal.top += pageSize;
            modal.index = Math.min(Math.max(0, modal.rows.length - 1), modal.index + pageSize);
            this.scheduleRender(10);
            return;
        }
        if (key.name === 'home') {
            modal.index = 0;
            modal.top = 0;
            this.scheduleRender(10);
            return;
        }
        if (key.name === 'end') {
            modal.index = Math.max(0, modal.rows.length - 1);
            this.scheduleRender(10);
            return;
        }
        if (key.name === 'return') {
            if (modal.kind === 'help' || modal.kind === 'doctor' || modal.kind === 'output') {
                return;
            }
            this.pickModal(modal.index);
            return;
        }
        if (modal.kind === 'packages') {
            if (char === 'a') {
                this.openInput('添加工具包', '输入工具包目录（含 config/menu.json）');
                return;
            }
            if (char === 'd') {
                this.removeSelectedPackage();
            }
        }
    }
    removeSelectedPackage() {
        const modal = this.modal;
        if (modal === null || this.bootstrap === null) {
            return;
        }
        const record = this.bootstrap.packages[modal.index];
        if (record === undefined) {
            return;
        }
        try {
            const next = this.loader.removePackage(record.path);
            this.bootstrap = { ...this.bootstrap, packages: next };
            modal.rows = next.map((entry) => {
                const summary = packageSummary(entry);
                return { label: summary.name, badge: summary.alive ? summary.version : '失效', hint: summary.configDir };
            });
            modal.title = `工具包 · 共 ${next.length} 个`;
            modal.index = clamp(modal.index, 0, Math.max(0, next.length - 1));
            this.showToast(`已移除 ${record.name}`, 'ok');
        }
        catch (error) {
            modal.error = describeError(error);
            this.renderNow();
        }
    }
    handleMouse(event) {
        if (this.closing || this.suspended) {
            return;
        }
        if (event.type === 'wheel') {
            if (this.modal !== null) {
                this.handleModalKey('', { name: event.wheel === 'up' ? 'up' : 'down' }, '');
                return;
            }
            this.move(event.wheel === 'up' ? -3 : 3);
            return;
        }
        if (event.type !== 'press' || event.button !== 0) {
            return;
        }
        const x = event.x - 1;
        const y = event.y - 1;
        for (let index = this.hits.length - 1; index >= 0; index -= 1) {
            const hit = this.hits[index];
            if (hit === undefined) {
                continue;
            }
            if (x >= hit.x && x < hit.x + hit.w && y >= hit.y && y < hit.y + hit.h) {
                hit.action({ x, y });
                return;
            }
        }
    }
    // ================= 生命周期 =================
    ensureUtf8Console() {
        if (process.platform !== 'win32') {
            return;
        }
        try {
            const shell = process.env['ComSpec'] ?? 'cmd.exe';
            spawn(shell, ['/d', '/c', 'chcp 65001 > nul'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {
                // 换不了代码页也不阻塞启动
            });
        }
        catch {
            // 忽略
        }
    }
    cleanupTerminal() {
        if (!this.tuiActive) {
            return;
        }
        this.tuiActive = false;
        try {
            this.stdout.write(`\x1b[0m\x1b[?25h\x1b[?7h${MOUSE_DISABLE}\x1b[?1049l`);
        }
        catch {
            // 终端已消失
        }
        try {
            this.stdin.setRawMode(false);
        }
        catch {
            // 忽略
        }
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.renderTimer !== null) {
            clearTimeout(this.renderTimer);
            this.renderTimer = null;
        }
        if (this.toastTimer !== null) {
            clearTimeout(this.toastTimer);
            this.toastTimer = null;
        }
        if (this.tickTimer !== null) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
        if (this.stdinHandler !== null) {
            this.stdin.removeListener('data', this.stdinHandler);
            this.stdinHandler = null;
        }
        if (this.inputStream !== null) {
            if (this.keyHandler !== null) {
                this.inputStream.removeListener('keypress', this.keyHandler);
            }
            this.inputStream.destroy();
            this.inputStream = null;
        }
        this.keyHandler = null;
        this.stdin.pause();
        if (this.resizeHandler !== null) {
            this.stdout.removeListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
        if (this.signalHandler !== null) {
            process.removeListener('SIGTERM', this.signalHandler);
            process.removeListener('SIGHUP', this.signalHandler);
            this.signalHandler = null;
        }
    }
    quit() {
        if (this.closing) {
            return;
        }
        this.closing = true;
        this.cleanupTerminal();
        const resolve = this.resolveExit;
        this.resolveExit = null;
        if (resolve !== null) {
            resolve();
        }
    }
    async run() {
        if (!this.stdout.isTTY || !this.stdin.isTTY) {
            throw new Error('当前不是交互式终端，无法启动 TUI（可用 qxctf list / qxctf run 在非交互环境使用）');
        }
        this.tuiActive = true;
        this.closing = false;
        this.ensureUtf8Console();
        this.stdout.write(`\x1b[?1049h\x1b[?25l\x1b[?7l${MOUSE_ENABLE}\x1b[2J\x1b[H`);
        this.stdin.setRawMode(true);
        this.stdin.resume();
        this.stdin.setEncoding('utf8');
        this.decoder = createInputDecoder();
        this.inputStream = new PassThrough();
        readline.emitKeypressEvents(this.inputStream);
        this.keyHandler = (sequence, key) => {
            // readline 对方向键 / 功能键可能给 undefined 的 sequence，统一兜成空串
            const text = typeof sequence === 'string' ? sequence : '';
            if (parseFocus(text) !== null) {
                this.scheduleRender(10);
                return;
            }
            const mouse = parseMouse(text);
            if (mouse !== null) {
                this.handleMouse(mouse);
                return;
            }
            this.handleKeypress(text, key ?? {});
        };
        this.inputStream.on('keypress', this.keyHandler);
        this.stdinHandler = (chunk) => {
            this.pumpInput(chunk);
        };
        this.stdin.on('data', this.stdinHandler);
        this.resizeHandler = () => {
            this.renderNow();
        };
        this.stdout.on('resize', this.resizeHandler);
        this.signalHandler = () => {
            this.quit();
        };
        process.on('SIGTERM', this.signalHandler);
        process.on('SIGHUP', this.signalHandler);
        this.tickTimer = setInterval(() => {
            if (this.closing) {
                return;
            }
            if (this.toast !== null && this.toast.until <= this.clock()) {
                this.toast = null;
                this.renderNow();
            }
        }, 800);
        this.renderNow();
        await new Promise((resolve) => {
            this.resolveExit = resolve;
        });
    }
    pumpInput(chunk) {
        if (this.decoder === null || this.inputStream === null) {
            return;
        }
        const result = this.decoder.push(chunk.toString());
        for (const event of result.events) {
            if (event.kind === 'mouse') {
                this.handleMouse(event.event);
            }
            else {
                this.scheduleRender(10);
            }
        }
        if (result.text !== '') {
            this.inputStream.write(result.text);
        }
        if (this.decoder.pending !== '') {
            if (this.flushTimer !== null) {
                clearTimeout(this.flushTimer);
            }
            this.flushTimer = setTimeout(() => {
                this.flushTimer = null;
                if (this.decoder === null || this.inputStream === null) {
                    return;
                }
                const flushed = this.decoder.flush();
                for (const event of flushed.events) {
                    if (event.kind === 'mouse') {
                        this.handleMouse(event.event);
                    }
                }
                if (flushed.text !== '') {
                    this.inputStream.write(flushed.text);
                }
            }, 24);
        }
    }
}
export function createTui(options) {
    return new QxCtfTui(options);
}
/** 旧名别名，保留给已经在用的脚本 */
export const CtfTui = QxCtfTui;
export { badgeOf, clamp, geometryFor, navEntries };
