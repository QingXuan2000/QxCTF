/**
 * 终端输入：鼠标 / 聚焦序列解析 + 增量解码器
 *
 * 移植自 sd-tui 的 src/ui/input.js 与 mouse.js（合并成一份，输入相关的都在这里）：
 * - 鼠标用 SGR(1006) 编码，避开 X10 协议的 223 列限制，兼容 Windows Terminal / iTerm2 / kitty
 * - readline 的 keypress 解码器会把鼠标上报拆成一串普通按键，导致点击终端时误触热键；
 *   这里先把鼠标 / 聚焦序列从原始输入里剥出来，剩下的文本再交给 readline
 */

/** 开启鼠标上报（按下 + 滚轮 + 聚焦） */
export const MOUSE_ENABLE = '\x1b[?1000h\x1b[?1006h\x1b[?1004h';
/** 关闭鼠标上报 */
export const MOUSE_DISABLE = '\x1b[?1000l\x1b[?1006l\x1b[?1004l';

/** 终端聚焦/失焦上报（CSI ?1004） */
export function parseFocus(sequence) {
    if (typeof sequence !== 'string') {
        return null;
    }
    if (sequence === '\x1b[I') {
        return 'in';
    }
    if (sequence === '\x1b[O') {
        return 'out';
    }
    return null;
}

/** 解析 SGR / X10 鼠标上报 */
export function parseMouse(sequence) {
    // readline 对部分按键（方向键等）会给出 undefined 的 sequence，先挡掉
    if (typeof sequence !== 'string' || sequence === '') {
        return null;
    }
    const sgr = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(sequence);
    if (sgr) {
        const code = Number(sgr[1]);
        const x = Number(sgr[2]);
        const y = Number(sgr[3]);
        const release = sgr[4] === 'm';
        const wheelBit = (code & 64) === 64;
        const buttonBits = code & 3;
        const base = {
            x,
            y,
            shift: (code & 4) === 4,
            meta: (code & 8) === 8,
            ctrl: (code & 16) === 16,
            sequence,
        };
        if (wheelBit) {
            return {
                ...base,
                type: 'wheel',
                button: null,
                wheel: buttonBits === 0 ? 'up' : buttonBits === 1 ? 'down' : null,
            };
        }
        return { ...base, type: release ? 'release' : 'press', button: buttonBits, wheel: null };
    }
    if (sequence.startsWith('\x1b[M') && sequence.length >= 6) {
        const raw = (index) => sequence.charCodeAt(index) - 32;
        const code = raw(3);
        const x = raw(4);
        const y = raw(5);
        if (x > 0 && y > 0) {
            const wheelBit = (code & 64) === 64;
            return {
                x,
                y,
                type: wheelBit ? 'wheel' : (code & 3) === 3 ? 'release' : 'press',
                button: (code & 3) === 3 ? null : code & 3,
                wheel: wheelBit ? ((code & 1) === 0 ? 'up' : 'down') : null,
                shift: (code & 4) === 4,
                meta: (code & 8) === 8,
                ctrl: (code & 16) === 16,
                sequence,
            };
        }
    }
    return null;
}

const CSI_FINAL_MIN = 0x40;
const CSI_FINAL_MAX = 0x7e;

function drain(buffer) {
    const events = [];
    let text = '';
    let index = 0;
    while (index < buffer.length) {
        const char = buffer[index];
        if (char !== '\x1b') {
            text += char;
            index += 1;
            continue;
        }
        // 孤立的 ESC 或跨读边界的序列前半段：等下一次数据
        if (index + 1 >= buffer.length) {
            break;
        }
        if (buffer[index + 1] === '[') {
            // X10 鼠标：ESC [ M b x y 共 6 字节
            if (buffer.startsWith('\x1b[M', index)) {
                if (index + 6 > buffer.length) {
                    break;
                }
                const sequence = buffer.slice(index, index + 6);
                const mouse = parseMouse(sequence);
                if (mouse !== null) {
                    events.push({ kind: 'mouse', event: mouse });
                }
                else {
                    text += sequence;
                }
                index += 6;
                continue;
            }
            // 通用 CSI：参数/中间字节 + 终止字节
            let end = index + 2;
            while (end < buffer.length) {
                const code = buffer.charCodeAt(end);
                if (code >= CSI_FINAL_MIN && code <= CSI_FINAL_MAX) {
                    break;
                }
                end += 1;
            }
            if (end >= buffer.length) {
                break;
            }
            const sequence = buffer.slice(index, end + 1);
            const focus = parseFocus(sequence);
            if (focus !== null) {
                events.push({ kind: 'focus', direction: focus });
            }
            else {
                const mouse = parseMouse(sequence);
                if (mouse !== null) {
                    events.push({ kind: 'mouse', event: mouse });
                }
                else {
                    text += sequence;
                }
            }
            index = end + 1;
            continue;
        }
        // SS3（应用模式方向键 / 功能键）三字节完整，交给 readline
        if (buffer[index + 1] === 'O') {
            if (index + 3 > buffer.length) {
                break;
            }
            text += buffer.slice(index, index + 3);
            index += 3;
            continue;
        }
        // ESC + 一个字符（Alt+键）或双 ESC
        text += buffer.slice(index, index + 2);
        index += 2;
    }
    return { events, text, rest: buffer.slice(index) };
}

/** 创建一个增量解码器 */
export function createInputDecoder() {
    let buffer = '';
    return {
        get pending() {
            return buffer;
        },
        push(chunk) {
            buffer += String(chunk ?? '');
            const result = drain(buffer);
            buffer = result.rest;
            return { events: result.events, text: result.text };
        },
        flush() {
            const result = drain(buffer);
            const tail = result.text + result.rest;
            buffer = '';
            return { events: result.events, text: tail };
        },
    };
}
