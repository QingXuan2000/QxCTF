/**
 * QxCTF 主题
 *
 * 配色取自 GitHub Primer。**整屏只有一个背景色**（`base`）：画布、顶栏、底栏、
 * 左栏、面板、选中行、弹层都用它，层次完全交给边框与前景色，不会出现深浅拼接的缝。
 *   深色 canvas.default `#0d1117`，浅色 `#ffffff`
 */
export const THEMES = {
    // GitHub 深色（Primer dark）
    dark: {
        base: '#0d1117',
        border: '#30363d',
        borderSoft: '#21262d',
        focusBorder: '#2f81f7',
        text: '#e6edf3',
        muted: '#9198a1',
        dim: '#656c76',
        title: '#79c0ff',
        accent: '#2f81f7',
        accent2: '#58a6ff',
        good: '#3fb950',
        warn: '#d29922',
        bad: '#f85149',
    },
    // GitHub 浅色（Primer light）
    light: {
        base: '#ffffff',
        border: '#d0d7de',
        borderSoft: '#d8dee4',
        focusBorder: '#0969da',
        text: '#1f2328',
        muted: '#59636e',
        dim: '#818b98',
        title: '#0969da',
        accent: '#0969da',
        accent2: '#0550ae',
        good: '#1a7f37',
        warn: '#9a6700',
        bad: '#cf222e',
    },
};
/** 可自定义的颜色键（顺序即设置页里的顺序） */
export const COLOR_KEYS = [
    'accent',
    'accent2',
    'title',
    'text',
    'muted',
    'dim',
    'border',
    'borderSoft',
    'focusBorder',
    'base',
    'good',
    'warn',
    'bad',
];
const HEX = /^#[0-9a-f]{6}$/i;
/**
 * 只保留合法的 hex 覆盖值
 *
 * 用户配色来自 settings.json，写错不该让界面崩掉：非法键与非法颜色一律丢弃，
 * 对应色位继续用内置默认值。
 */
export function sanitizeColors(overrides) {
    if (overrides === null || typeof overrides !== 'object') {
        return {};
    }
    const result = {};
    for (const key of COLOR_KEYS) {
        const value = overrides[key];
        if (typeof value === 'string' && HEX.test(value.trim())) {
            result[key] = value.trim().toLowerCase();
        }
    }
    return result;
}
/** 取主题：内置配色 + 用户覆盖（未覆盖的色位用默认值） */
export function resolveTheme(name, overrides) {
    const key = name ?? 'dark';
    const base = THEMES[key] ?? THEMES['dark'] ?? THEMES['light'];
    const custom = sanitizeColors(overrides);
    return Object.keys(custom).length === 0 ? base : { ...base, ...custom };
}
/** 颜色模式：显式设置 > 环境变量 > 终端能力探测 */
export function detectColorMode(setting) {
    if (setting !== undefined && setting !== null && setting !== 'auto') {
        if (['truecolor', '256', '16', 'none'].includes(setting)) {
            return setting;
        }
    }
    const env = process.env;
    const colorEnv = env['QXCTF_COLOR'] ?? env['CTF_COLOR'] ?? env['SDM_COLOR'];
    if (colorEnv !== undefined) {
        const value = colorEnv.toLowerCase();
        if (['truecolor', '256', '16', 'none'].includes(value)) {
            return value;
        }
    }
    if (env['NO_COLOR'] !== undefined) {
        return 'none';
    }
    if (env['COLORTERM'] !== undefined && /truecolor|24bit/i.test(env['COLORTERM'])) {
        return 'truecolor';
    }
    if (/truecolor/i.test(env.TERM ?? '')) {
        return 'truecolor';
    }
    if (process.platform === 'win32') {
        return 'truecolor';
    }
    if (/256color/i.test(env.TERM ?? '')) {
        return '256';
    }
    return '16';
}
