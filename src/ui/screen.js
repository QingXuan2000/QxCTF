/**
 * 字符单元屏幕缓冲
 *
 * 移植自 sd-tui 的 src/ui/screen.js：
 * - 维护一个 width × height 的 Cell 网格，所有绘制都写进网格
 * - 渲染时按行绝对定位输出，逐段合并相同样式，最后一次性写屏
 * - 记录鼠标命中区域（hitbox），供点击定位用
 *
 * 因为绘制结果是纯数据，测试可以直接读 `toLines()` 做断言，不需要真终端。
 */
import { charWidth, clipText, strWidth } from './width.js';
/** 各风格的四个角 */
const CORNERS = {
    square: ['┌', '┐', '└', '┘'],
    rounded: ['╭', '╮', '╰', '╯'] };
const ANSI16 = [
    [0, 0, 0], [170, 0, 0], [0, 170, 0], [170, 85, 0],
    [0, 0, 170], [170, 0, 170], [0, 170, 170], [170, 170, 170],
    [85, 85, 85], [255, 85, 85], [85, 255, 85], [255, 255, 85],
    [85, 85, 255], [255, 85, 255], [85, 255, 255], [255, 255, 255],
];
function parseHex(hex) {
    const value = String(hex ?? '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(value)) {
        return null;
    }
    return [
        Number.parseInt(value.slice(0, 2), 16),
        Number.parseInt(value.slice(2, 4), 16),
        Number.parseInt(value.slice(4, 6), 16),
    ];
}
function nearestIndex(rgb, palette) {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    palette.forEach((entry, index) => {
        const dr = rgb[0] - entry[0];
        const dg = rgb[1] - entry[1];
        const db = rgb[2] - entry[2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
        }
    });
    return best;
}
/** #rrggbb -> 256 色索引 */
function rgbTo256(rgb) {
    const toCube = (value) => Math.round((Math.max(0, Math.min(255, value)) / 255) * 5);
    const ri = toCube(rgb[0]);
    const gi = toCube(rgb[1]);
    const bi = toCube(rgb[2]);
    const cubeIndex = 16 + 36 * ri + 6 * gi + bi;
    const cube = [ri * 51, gi * 51, bi * 51];
    const grayAverage = Math.round((rgb[0] + rgb[1] + rgb[2]) / 3);
    const grayIndex = Math.max(0, Math.min(23, Math.round((grayAverage - 8) / 10)));
    const gray = 8 + grayIndex * 10;
    const cubeDist = (rgb[0] - cube[0]) ** 2 + (rgb[1] - cube[1]) ** 2 + (rgb[2] - cube[2]) ** 2;
    const grayDist = (rgb[0] - gray) ** 2 + (rgb[1] - gray) ** 2 + (rgb[2] - gray) ** 2;
    return grayDist < cubeDist ? 232 + grayIndex : cubeIndex;
}
function colorCode(hex, mode, background) {
    if (hex === undefined || hex === '' || mode === 'none') {
        return null;
    }
    const rgb = parseHex(hex);
    if (rgb === null) {
        return null;
    }
    if (mode === 'truecolor') {
        return `${background ? 48 : 38};2;${rgb[0]};${rgb[1]};${rgb[2]}`;
    }
    if (mode === '256') {
        return `${background ? 48 : 38};5;${rgbTo256(rgb)}`;
    }
    const index = nearestIndex(rgb, ANSI16);
    if (index < 8) {
        return String((background ? 40 : 30) + index);
    }
    return String((background ? 100 : 90) + (index - 8));
}
function styleKey(style) {
    if (!style) {
        return '';
    }
    return `${style.fg ?? ''}|${style.bg ?? ''}|${style.bold ? 1 : 0}|${style.dim ? 1 : 0}|${style.underline ? 1 : 0}`;
}
function sgr(style, mode) {
    const parts = ['0'];
    if (style.bold) {
        parts.push('1');
    }
    if (style.dim) {
        parts.push('2');
    }
    if (style.underline) {
        parts.push('4');
    }
    const fg = colorCode(style.fg, mode, false);
    if (fg !== null) {
        parts.push(fg);
    }
    const bg = colorCode(style.bg, mode, true);
    if (bg !== null) {
        parts.push(bg);
    }
    return `\x1b[${parts.join(';')}m`;
}
class Cell {
    ch;
    w;
    style;
    constructor(ch = ' ', w = 1, style = null) {
        this.ch = ch;
        this.w = w;
        this.style = style;
    }
}
export class Screen {
    width;
    height;
    hits = [];
    rows;
    themeBorder;
    constructor(width, height, borderColor = '#30363d') {
        this.width = Math.max(1, width);
        this.height = Math.max(1, height);
        this.themeBorder = borderColor;
        this.rows = Array.from({ length: this.height }, () => this.blankRow());
    }
    /** 登记一块鼠标命中区域 */
    hit(x, y, w, h, action, layer = 'base') {
        if (w <= 0 || h <= 0) {
            return;
        }
        this.hits.push({ x, y, w, h, action, layer });
    }
    /** 取坐标处的命中区域（后登记的优先，便于覆盖） */
    hitAt(x, y) {
        for (let index = this.hits.length - 1; index >= 0; index -= 1) {
            const hit = this.hits[index];
            if (hit === undefined) {
                continue;
            }
            if (x >= hit.x && x < hit.x + hit.w && y >= hit.y && y < hit.y + hit.h) {
                return hit;
            }
        }
        return null;
    }
    blankRow() {
        return Array.from({ length: this.width }, () => new Cell(' ', 1, null));
    }
    clear(style) {
        for (let y = 0; y < this.height; y += 1) {
            const row = this.rows[y];
            if (row === undefined) {
                continue;
            }
            for (let x = 0; x < this.width; x += 1) {
                row[x] = new Cell(' ', 1, style ?? null);
            }
        }
    }
    clearCell(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return null;
        }
        const row = this.rows[y];
        const cell = row?.[x];
        if (row === undefined || cell === undefined) {
            return null;
        }
        if (cell.w === 2) {
            row[x] = new Cell(' ', 1, cell.style);
            if (x + 1 < this.width) {
                row[x + 1] = new Cell(' ', 1, cell.style);
            }
        }
        else if (cell.w === 0) {
            row[x] = new Cell(' ', 1, cell.style);
            const left = row[x - 1];
            if (x - 1 >= 0 && left !== undefined && left.w === 2) {
                row[x - 1] = new Cell(' ', 1, left.style);
            }
        }
        return cell.style;
    }
    put(x, y, char, width, style) {
        if (x < 0 || y < 0 || y >= this.height) {
            return;
        }
        if (x >= this.width) {
            return;
        }
        const row = this.rows[y];
        if (row === undefined) {
            return;
        }
        // 字色可以只给前景：没写 bg 时沿用格子已有的底色（面板里写字不必反复传 bg）
        const inherited = row[x]?.style?.bg;
        const paint = style !== null && style !== undefined && style.bg === undefined && inherited !== undefined
            ? { ...style, bg: inherited }
            : style;
        if (width === 2 && x + 1 >= this.width) {
            this.clearCell(x, y);
            row[x] = new Cell(' ', 1, paint);
            return;
        }
        this.clearCell(x, y);
        if (width === 2) {
            this.clearCell(x + 1, y);
        }
        row[x] = new Cell(char, width, paint);
        if (width === 2) {
            row[x + 1] = new Cell('', 0, paint);
        }
    }
    /** 写一段文本，返回结束列 */
    text(x, y, value, style, options = {}) {
        if (y < 0 || y >= this.height) {
            return x;
        }
        const maxWidth = Math.max(0, options.maxWidth ?? this.width - x);
        if (maxWidth <= 0) {
            return x;
        }
        const clipped = clipText(value === null || value === undefined ? '' : String(value), maxWidth, options.ellipsis ?? '…');
        const width = strWidth(clipped);
        let cursor = x;
        if (options.align === 'right') {
            cursor = x + maxWidth - width;
        }
        else if (options.align === 'center') {
            cursor = x + Math.floor((maxWidth - width) / 2);
        }
        const limit = x + maxWidth;
        for (const char of clipped) {
            const w = charWidth(char);
            if (w === 0) {
                continue;
            }
            if (cursor + w > limit) {
                break;
            }
            this.put(cursor, y, char, w, style);
            cursor += w;
        }
        return cursor;
    }
    fillRect(x, y, width, height, style) {
        for (let row = 0; row < height; row += 1) {
            for (let col = 0; col < width; col += 1) {
                const px = x + col;
                const py = y + row;
                if (px < 0 || px >= this.width || py < 0 || py >= this.height) {
                    continue;
                }
                this.clearCell(px, py);
                const target = this.rows[py];
                if (target !== undefined) {
                    target[px] = new Cell(' ', 1, style);
                }
            }
        }
    }
    hline(x, y, width, style, char = '─') {
        for (let index = 0; index < width; index += 1) {
            this.put(x + index, y, char, 1, style);
        }
    }
    vline(x, y, height, style, char = '│') {
        for (let index = 0; index < height; index += 1) {
            this.put(x, y + index, char, 1, style);
        }
    }
    /** 面板：填充 + 边框 + 可选标题（默认直角框） */
    box(x, y, width, height, options = {}) {
        if (width < 2 || height < 2) {
            return;
        }
        const kind = options.border ?? 'square';
        const corners = CORNERS[kind] ?? CORNERS.square;
        const style = options.style ?? { fg: '#e6edf3' };
        const border = options.borderStyle ?? { fg: this.themeBorder };
        this.fillRect(x, y, width, height, style);
        this.hline(x + 1, y, width - 2, border);
        this.hline(x + 1, y + height - 1, width - 2, border);
        this.vline(x, y + 1, height - 2, border);
        this.vline(x + width - 1, y + 1, height - 2, border);
        const [topLeft, topRight, bottomLeft, bottomRight] = corners;
        this.put(x, y, topLeft, 1, border);
        this.put(x + width - 1, y, topRight, 1, border);
        this.put(x, y + height - 1, bottomLeft, 1, border);
        this.put(x + width - 1, y + height - 1, bottomRight, 1, border);
        if (options.title !== undefined && options.title !== '') {
            const titleStyle = options.titleStyle ?? { fg: '#79c0ff', bold: true };
            this.text(x + 2, y, ` ${options.title} `, titleStyle, { maxWidth: Math.max(0, width - 4) });
        }
        if (options.rightTitle !== undefined && options.rightTitle !== '') {
            const rightStyle = options.rightTitleStyle ?? { fg: '#6e7681' };
            const label = ` ${options.rightTitle} `;
            this.text(x + width - 2 - strWidth(label), y, label, rightStyle, { maxWidth: strWidth(label) });
        }
    }
    /** 把网格渲染成 ANSI 字符串（按行绝对定位，避免自动换行错位） */
    render(colorMode = 'truecolor') {
        const out = ['\x1b[0m'];
        let lastKey = null;
        for (let y = 0; y < this.height; y += 1) {
            out.push(`\x1b[${y + 1};1H`);
            const row = this.rows[y];
            if (row === undefined) {
                continue;
            }
            for (let x = 0; x < this.width; x += 1) {
                const cell = row[x];
                if (cell === undefined || cell.w === 0) {
                    continue;
                }
                const key = styleKey(cell.style);
                if (key !== lastKey) {
                    out.push(sgr(cell.style ?? {}, colorMode));
                    lastKey = key;
                }
                out.push(cell.ch === '' ? ' ' : cell.ch);
            }
        }
        out.push('\x1b[0m');
        return out.join('');
    }
    /** 网格 -> 纯文本行（测试与快照用，不含 ANSI） */
    toLines() {
        const lines = [];
        for (let y = 0; y < this.height; y += 1) {
            const row = this.rows[y];
            if (row === undefined) {
                lines.push('');
                continue;
            }
            let line = '';
            for (let x = 0; x < this.width; x += 1) {
                const cell = row[x];
                if (cell === undefined || cell.w === 0) {
                    continue;
                }
                line += cell.ch === '' ? ' ' : cell.ch;
            }
            lines.push(line.replace(/\s+$/u, ''));
        }
        return lines;
    }
}
