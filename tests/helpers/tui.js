/**
 * TUI 测试脚手架
 *
 * 渲染层是纯数据（状态 → 字符网格），所以测试不需要 pty：
 * 构造 QxCtfTui，用 snapshot() 取纯文本帧，用 handleKeypress / handleMouse 驱动。
 */
import { loadBootstrap } from '../../src/core/bootstrap.js';
import { QxCtfTui } from '../../src/tui/app.js';
import { strWidth } from '../../src/ui/width.js';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** 执行器替身：只记录调用，不落子进程 */
export function fakeExecutor(code = 0, tail = ['(fake output)']) {
    const calls = [];
    const executor = (plan) => {
        calls.push(plan);
        return Promise.resolve({ code, signal: null, tail });
    };
    return { executor, calls };
}
/** 不落盘的 loader 替身 */
function fakeLoader(initial) {
    const packages = initial?.packages ?? [];
    return {
        load: (configDir) => loadBootstrap({ configDir: configDir ?? initial?.configDir ?? null }),
        switchTo: (target) => loadBootstrap({ configDir: target }),
        listPackages: () => packages,
        addPackage: () => packages,
        removePackage: () => packages,
    };
}
export function makeTui(bootstrap, options = {}) {
    const size = options.size ?? { columns: 108, rows: 28 };
    const tui = new QxCtfTui({
        initial: bootstrap,
        loader: options.loader ?? fakeLoader(bootstrap),
        execute: options.execute ?? fakeExecutor().executor,
        size,
        now: options.now ?? (() => Date.now()),
    });
    const lines = () => tui.snapshot(size.columns, size.rows);
    return {
        tui,
        lines,
        text: () => lines().join('\n'),
        key: async (sequence, key = {}) => {
            tui.handleKeypress(sequence, key);
            await tick();
        },
        type: async (text) => {
            for (const char of text) {
                tui.handleKeypress(char, {});
            }
            await tick();
        },
        click: async (column, row) => {
            lines();
            const event = {
                x: column + 1,
                y: row + 1,
                type: 'press',
                button: 0,
                wheel: null,
                shift: false,
                meta: false,
                ctrl: false,
                sequence: '',
            };
            tui.handleMouse(event);
            await tick();
        },
        wheel: async (direction) => {
            lines();
            tui.handleMouse({
                x: 1,
                y: 1,
                type: 'wheel',
                button: null,
                wheel: direction,
                shift: false,
                meta: false,
                ctrl: false,
                sequence: '',
            });
            await tick();
        },
        idle: async () => {
            await tui.idle();
            await tick();
        },
    };
}
export const keys = {
    up: { name: 'up' },
    down: { name: 'down' },
    left: { name: 'left' },
    right: { name: 'right' },
    enter: { name: 'return' },
    escape: { name: 'escape' },
    backspace: { name: 'backspace' },
    pageUp: { name: 'pageup' },
    pageDown: { name: 'pagedown' },
};
export function findRow(lines, needle) {
    return lines.findIndex((line) => line.includes(needle));
}
/** 按显示宽度换算列号（中文占 2 列但只占 1 个 JS 字符） */
export function findColumn(lines, row, needle) {
    const line = lines[row];
    if (line === undefined) {
        return -1;
    }
    const index = line.indexOf(needle);
    return index < 0 ? -1 : strWidth(line.slice(0, index));
}
