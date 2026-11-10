/**
 * 终端输入解码测试
 *
 * 覆盖鼠标 / 聚焦序列的剥离，以及 readline 传给 keypress 的「非字符串 sequence」
 * 这类边界（方向键在部分 Node 版本上 str 是 undefined，曾经把 TUI 打崩）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MOUSE_DISABLE, MOUSE_ENABLE, createInputDecoder, parseFocus, parseMouse } from '../src/ui/input.js';

const ESC = String.fromCharCode(27);

describe('输入解码', () => {
    it('方向键原样透传给 readline', () => {
        const decoder = createInputDecoder();
        const down = decoder.push(`${ESC}[B`);
        assert.deepEqual(down.events, []);
        assert.equal(down.text, `${ESC}[B`);
    });
    it('SGR 鼠标上报被剥成事件', () => {
        const decoder = createInputDecoder();
        const result = decoder.push(`${ESC}[<0;10;5M`);
        assert.equal(result.text, '');
        assert.equal(result.events.length, 1);
        assert.equal(result.events[0].kind, 'mouse');
        assert.equal(result.events[0].event.type, 'press');
        assert.equal(result.events[0].event.x, 10);
    });
    it('聚焦 / 失焦事件', () => {
        const decoder = createInputDecoder();
        assert.equal(decoder.push(`${ESC}[I`).events[0].direction, 'in');
        assert.equal(decoder.push(`${ESC}[O`).events[0].direction, 'out');
    });
    it('跨数据块拆开的鼠标序列会被缓存', () => {
        const decoder = createInputDecoder();
        const first = decoder.push(`${ESC}[<0;1`);
        assert.equal(first.text, '');
        assert.equal(first.events.length, 0);
        const second = decoder.push('0;5M');
        assert.equal(second.events.length, 1);
        assert.equal(second.events[0].event.y, 5);
    });
    it('普通文本原样返回', () => {
        const decoder = createInputDecoder();
        assert.equal(decoder.push('abc').text, 'abc');
    });
});

describe('鼠标 / 聚焦解析的健壮性', () => {
    it('非字符串序列一律返回 null（方向键的 sequence 可能是 undefined）', () => {
        for (const value of [undefined, null, 0, {}, []]) {
            assert.equal(parseMouse(value), null);
            assert.equal(parseFocus(value), null);
        }
    });
    it('空串不匹配任何鼠标序列', () => {
        assert.equal(parseMouse(''), null);
        assert.equal(parseFocus(''), null);
    });
    it('方向键序列不会被误判为鼠标', () => {
        for (const seq of [`${ESC}[A`, `${ESC}[B`, `${ESC}[C`, `${ESC}[D`, `${ESC}[5~`]) {
            assert.equal(parseMouse(seq), null);
            assert.equal(parseFocus(seq), null);
        }
    });
    it('鼠标开关是成对的转义序列', () => {
        assert.match(MOUSE_ENABLE, /1006h/);
        assert.match(MOUSE_DISABLE, /1006l/);
    });
});
