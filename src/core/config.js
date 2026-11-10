/**
 * 配置加载与校验
 *
 * 磁盘上的三种 JSON 都在这里被解析、校验、归一化成强类型对象：
 * - menu.json        菜单结构
 * - settings.json    应用信息与界面行为
 * - arch_picker.json 架构选择器
 *
 * 校验失败一律抛 QxCtfError，并带上「哪个文件、哪个字段」的定位信息，
 * 避免用户面对一句 “JSON 解析错误” 无从下手。
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { QxCtfError } from './errors.js';
const MENU_FILE = 'menu.json';
const SETTINGS_FILE = 'settings.json';
/** 工具路径：单条命令，或按架构分组的命令映射 */
const toolPathSchema = z.union([z.string().min(1), z.record(z.string(), z.string())]);
/** 菜单项 */
const menuItemSchema = z.object({
    id: z.number().int(),
    name: z.string(),
    type: z.enum(['submenu', 'executable', 'back', 'main']).optional(),
    desc: z.string().optional(),
    submenu: z.string().optional(),
    path: toolPathSchema.optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    // 选项详情：单行字符串或字符串数组，渲染在首页底部详情区
    detail: z.union([z.string(), z.array(z.string())]).optional(),
});
/** 菜单节点 */
const menuNodeSchema = z.object({
    title: z.string().optional(),
    parent: z.string().optional(),
    // 条目逐条手动校验：既支持普通菜单项，也支持「分区名: [条目...]」形式，
    // 这样报错路径能精确到 menu.main.items.0.id 而不是笼统的 items.0
    items: z.array(z.unknown()).optional(),
});
/** menu.json 顶层 */
const menuConfigSchema = z.object({
    menu: z.record(z.string(), menuNodeSchema),
});
/**
 * settings.json 顶层
 *
 * 推荐扁平写法（`name` / `version` / `theme` / `color` / `archPicker`）；
 * 旧版的 `app` / `settings` 嵌套仍然接受。已删除的字段（`logo`、`display_clear`、
 * `input_method`、`arrow_indicator`）旧配置里出现也不会报错，未知字段被忽略。
 */
const themeColorsSchema = z.record(z.string(), z.string()).optional();
const settingsSchema = z.object({
    // 新版扁平字段
    name: z.string().optional(),
    version: z.string().optional(),
    theme: z.string().optional(),
    color: z.string().optional(),
    archPicker: z.boolean().optional(),
    /** 自定义配色：{ dark: { accent: "#ff8800" }, light: { ... } }，只写要覆盖的色位 */
    colors: z.object({ dark: themeColorsSchema, light: themeColorsSchema }).optional(),
    // 旧版嵌套字段（兼容）
    app: z.object({ name: z.string().optional(), version: z.string().optional() }).optional(),
    settings: z
        .object({
        arch_picker: z.boolean().optional(),
        ui_theme: z.string().optional(),
        color_mode: z.string().optional(),
    })
        .optional(),
});
/** 架构键的固定优先顺序，其余键按字母序补在后面 */
const ARCH_ORDER = ['X86_64', 'X86', 'ARM64', 'ARM32'];
/**
 * 从 menu.json 里汇总架构选项
 *
 * 只要某项的 path 是架构映射，它的键就是可选的架构；不需要额外的 arch_picker.json。
 * 排序：先按 ARCH_ORDER 的固定顺序，剩下的键按字母序。
 */
export function deriveArchOptions(menu) {
    const values = new Set();
    for (const node of Object.values(menu)) {
        for (const item of node.items) {
            const toolPath = item.path;
            if (typeof toolPath === 'object' && toolPath !== null) {
                for (const key of Object.keys(toolPath)) {
                    if (key.trim() !== '') {
                        values.add(key);
                    }
                }
            }
        }
    }
    const rank = (value) => {
        const index = ARCH_ORDER.indexOf(value.toUpperCase());
        return index === -1 ? ARCH_ORDER.length : index;
    };
    return [...values]
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
        .map((value) => ({ display: value, value }));
}
/** 读 JSON 并去掉可能的 BOM */
function readJsonFile(file) {
    let raw;
    try {
        raw = fs.readFileSync(file, 'utf8');
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            throw new QxCtfError(`配置文件不存在：${file}`, '运行 `qxctf init <目录>` 可生成一份可用的示例配置');
        }
        throw new QxCtfError(`无法读取配置文件：${file}`, error.message);
    }
    const text = raw.replace(/^\uFEFF/, '');
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new QxCtfError(`JSON 解析失败：${file}`, error.message);
    }
}
/** 把 zod 的 issue 列表压成人类可读的多行文本 */
function formatIssues(file, issues) {
    const lines = issues.map((issue) => {
        const where = issue.path.length > 0 ? issue.path.map(String).join('.') : '(根)';
        return `  · ${where}: ${issue.message}`;
    });
    return `${file} 校验失败：\n${lines.join('\n')}`;
}
/** 把一条 issue 压成「路径: 说明」，供手工逐条校验时拼接 */
function issueLine(basePath, issue) {
    const tail = issue.path.length > 0 ? `.${issue.path.map(String).join('.')}` : '';
    return `${basePath}${tail}: ${issue.message}`;
}
/** 从配置里推断菜单项类型，兼容省略 type 的旧配置 */
function inferType(item) {
    if (item.type !== undefined) {
        return item.type;
    }
    if (item.submenu !== undefined) {
        return 'submenu';
    }
    if (item.path !== undefined) {
        return 'executable';
    }
    return 'executable';
}
/** 路径映射里是否至少有一条非空命令 */
function hasCommand(spec) {
    if (spec === undefined) {
        return false;
    }
    if (typeof spec === 'string') {
        return spec.trim() !== '';
    }
    return Object.values(spec).some((value) => value.trim() !== '');
}
/**
 * 加载并校验 menu.json
 *
 * 校验内容：main 菜单存在、同层 id 唯一、submenu 引用可解析、executable 带 path。
 */
export function loadMenuConfig(configDir) {
    const file = path.join(configDir, MENU_FILE);
    const raw = readJsonFile(file);
    const parsed = menuConfigSchema.safeParse(raw);
    if (!parsed.success) {
        throw new QxCtfError(formatIssues(file, parsed.error.issues), '按 schema 修正字段后重试');
    }
    const menu = {};
    const schemaProblems = [];
    for (const [menuId, node] of Object.entries(parsed.data.menu)) {
        const items = [];
        (node.items ?? []).forEach((entry, entryIndex) => {
            const basePath = `menu.${menuId}.items.${entryIndex}`;
            const isSection = typeof entry === 'object' && entry !== null && !('id' in entry);
            // 分区写法：{ "分区名": [ {条目}, {条目} ] }
            if (isSection) {
                for (const [sectionTitle, list] of Object.entries(entry)) {
                    if (!Array.isArray(list)) {
                        schemaProblems.push(`${basePath}.${sectionTitle}: 分区内容必须是数组`);
                        continue;
                    }
                    list.forEach((item, itemIndex) => {
                        const result = menuItemSchema.safeParse(item);
                        if (!result.success) {
                            for (const issue of result.error.issues) {
                                schemaProblems.push(issueLine(`${basePath}.${sectionTitle}.${itemIndex}`, issue));
                            }
                            return;
                        }
                        items.push({ ...result.data, type: inferType(result.data), section: sectionTitle });
                    });
                }
                return;
            }
            const result = menuItemSchema.safeParse(entry);
            if (!result.success) {
                for (const issue of result.error.issues) {
                    schemaProblems.push(issueLine(basePath, issue));
                }
                return;
            }
            items.push({ ...result.data, type: inferType(result.data) });
        });
        menu[menuId] = {
            title: node.title ?? '',
            items,
            ...(node.parent !== undefined ? { parent: node.parent } : {}),
        };
    }
    if (schemaProblems.length > 0) {
        throw new QxCtfError(`${file} 校验失败：\n${schemaProblems.map((line) => `  · ${line}`).join('\n')}`, '按 schema 修正字段后重试');
    }
    if (menu['main'] === undefined) {
        throw new QxCtfError(`${file} 缺少 main 菜单`, '菜单配置必须包含 ID 为 main 的入口菜单');
    }
    const problems = [];
    for (const [menuId, node] of Object.entries(menu)) {
        const seen = new Set();
        for (const item of node.items) {
            if (seen.has(item.id)) {
                problems.push(`菜单 ${menuId} 中 id=${item.id} 重复`);
            }
            seen.add(item.id);
            if (item.type === 'submenu') {
                if (item.submenu === undefined) {
                    problems.push(`菜单 ${menuId} 的 id=${item.id} 是 submenu 但缺少 submenu 字段`);
                }
                else if (menu[item.submenu] === undefined) {
                    problems.push(`菜单 ${menuId} 的 id=${item.id} 指向不存在的子菜单 ${item.submenu}`);
                }
            }
            if (item.type === 'executable' && !hasCommand(item.path)) {
                problems.push(`菜单 ${menuId} 的 id=${item.id} 是 executable 但 path 为空`);
            }
            if (item.cwd !== undefined && item.cwd.trim() === '') {
                problems.push(`菜单 ${menuId} 的 id=${item.id} 的 cwd 为空字符串`);
            }
        }
    }
    if (problems.length > 0) {
        const lines = problems.map((line) => `  · ${line}`).join('\n');
        throw new QxCtfError(`${file} 存在 ${problems.length} 处结构问题：\n${lines}`);
    }
    return { menu };
}
/** 加载 settings.json；文件缺失时返回空对象（全部走默认值） */
export function loadSettings(configDir) {
    const file = path.join(configDir, SETTINGS_FILE);
    if (!fs.existsSync(file)) {
        return {};
    }
    const raw = readJsonFile(file);
    const parsed = settingsSchema.safeParse(raw);
    if (!parsed.success) {
        throw new QxCtfError(formatIssues(file, parsed.error.issues));
    }
    return parsed.data;
}
/** 从 settings.json 读出工具包自报信息，缺失时退回目录名 */
export function readPackageInfo(configDir, packageRoot) {
    const resolved = resolveSettings(loadSettings(configDir), packageRoot);
    return { name: resolved.appName, version: resolved.appVersion };
}
/**
 * 写回 settings.json（TUI 设置弹层用）
 *
 * 只合并传入的键，保留文件里其它字段（包括旧版嵌套写法），
 * 写回后仍是 2 空格缩进的 JSON。
 */
export function updateSettingsFile(configDir, patch) {
    const file = path.join(configDir, SETTINGS_FILE);
    let raw = {};
    if (fs.existsSync(file)) {
        try {
            const parsed = readJsonFile(file);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                raw = parsed;
            }
        }
        catch {
            raw = {};
        }
    }
    const merged = { ...raw, ...patch };
    try {
        fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    }
    catch (error) {
        throw new QxCtfError(`无法写入 ${file}`, error.message);
    }
    return merged;
}
/** settings.json -> 归一化设置（新扁平写法优先，旧嵌套写法兜底） */
export function resolveSettings(settings, packageRoot) {
    const legacy = settings.settings ?? {};
    const theme = settings.theme ?? legacy.ui_theme;
    return {
        appName: settings.name ?? settings.app?.name ?? path.basename(path.resolve(packageRoot)),
        appVersion: settings.version ?? settings.app?.version ?? '未知版本',
        archPicker: settings.archPicker ?? legacy.arch_picker ?? false,
        themeName: theme === 'light' ? 'light' : 'dark',
        colorMode: settings.color ?? legacy.color_mode ?? 'auto',
        // 自定义配色（未配置则为空对象，界面用内置配色）
        colors: {
            dark: settings.colors?.dark ?? {},
            light: settings.colors?.light ?? {},
        },
    };
}
