import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { clearHistory, loadFavorites, loadHistory, pushHistory, recentMap, saveFavorites, toggleFavorite, toolKey, } from '../src/core/store.js';
import { tempDir } from './helpers/fixtures.js';
function useHome() {
    const home = tempDir('qxctf-home-');
    process.env['QXCTF_HOME'] = home;
    return home;
}
describe('收藏', () => {
    it('初始为空，可切换、可保存、去重', () => {
        useHome();
        assert.deepEqual(loadFavorites(), []);
        const key = toolKey('/tmp/pack', 'main', 3);
        assert.deepEqual(toggleFavorite(key), [key]);
        assert.deepEqual(loadFavorites(), [key]);
        // 再切换一次即移除
        assert.deepEqual(toggleFavorite(key), []);
        assert.deepEqual(loadFavorites(), []);
        saveFavorites([key, key, 'other::main::1']);
        assert.deepEqual(loadFavorites(), [key, 'other::main::1']);
    });
    it('工具键带工具包根，不同包不会串', () => {
        useHome();
        const a = toolKey('/tmp/a', 'main', 1);
        const b = toolKey('/tmp/b', 'main', 1);
        assert.notEqual(a, b);
        saveFavorites([a]);
        assert.deepEqual(loadFavorites(), [a]);
    });
});
describe('执行历史', () => {
    it('最新在前，同键去重，保留尾部输出', () => {
        useHome();
        clearHistory();
        const key = toolKey('/tmp/pack', 'main', 1);
        pushHistory({ key, name: 'a', command: 'a', arch: 'default', code: 0, ms: 10, at: 100, tail: ['one'] });
        pushHistory({ key, name: 'a', command: 'a', arch: 'default', code: 1, ms: 20, at: 200, tail: ['two'] });
        const history = loadHistory();
        assert.equal(history.length, 1);
        assert.equal(history[0]?.at, 200);
        assert.equal(history[0]?.code, 1);
        assert.deepEqual(history[0]?.tail, ['two']);
    });
    it('不同工具按时间倒序', () => {
        useHome();
        clearHistory();
        pushHistory({ key: 'r::main::1', name: 'a', command: 'a', arch: 'default', code: 0, ms: 1, at: 100, tail: [] });
        pushHistory({ key: 'r::main::2', name: 'b', command: 'b', arch: 'default', code: 0, ms: 1, at: 300, tail: [] });
        pushHistory({ key: 'r::main::3', name: 'c', command: 'c', arch: 'default', code: 0, ms: 1, at: 200, tail: [] });
        assert.deepEqual(loadHistory().map((entry) => entry.name), ['b', 'c', 'a']);
    });
    it('recentMap 取每个键的最近时间', () => {
        const map = recentMap([
            { key: 'k', name: 'a', command: 'a', arch: 'default', code: 0, ms: 1, at: 200, tail: [] },
            { key: 'k', name: 'a', command: 'a', arch: 'default', code: 0, ms: 1, at: 100, tail: [] },
            { key: 'j', name: 'b', command: 'b', arch: 'default', code: 0, ms: 1, at: 150, tail: [] },
        ]);
        assert.equal(map.get('k'), 200);
        assert.equal(map.get('j'), 150);
    });
    it('损坏文件退化为空', () => {
        const home = useHome();
        fs.writeFileSync(path.join(home, 'history.json'), '{ broken', 'utf8');
        assert.deepEqual(loadHistory(), []);
    });
});
