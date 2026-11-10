import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadBootstrap } from '../src/core/bootstrap.js';
import { countItems } from '../src/core/menu.js';
import { scaffoldConfig } from '../src/core/scaffold.js';
import { tempDir } from './helpers/fixtures.js';
/** 让 bootstrap 里的注册表读取落在临时目录 */
function useHome() {
    process.env['QXCTF_HOME'] = tempDir('qxctf-home-');
}
describe('qxctf init 脚手架', () => {
    it('生成可加载的工具包', () => {
        useHome();
        const dir = tempDir();
        const result = scaffoldConfig(dir);
        assert.equal(result.configDir, path.join(dir, 'config'));
        // 只有两个配置文件；arch_picker.json / logo 已不再生成
        for (const file of ['menu.json', 'settings.json']) {
            assert.ok(fs.existsSync(path.join(result.configDir, file)), `缺少 ${file}`);
        }
        for (const gone of ['arch_picker.json', 'logo']) {
            assert.ok(!fs.existsSync(path.join(result.configDir, gone)), `不应再生成 ${gone}`);
        }
        const bootstrap = loadBootstrap({ configDir: dir });
        assert.equal(bootstrap.packageInfo.name, 'qxctf-demo');
        assert.equal(bootstrap.packageInfo.version, '1.0.0');
        assert.equal(bootstrap.archOptions.length, 4);
        assert.equal(countItems(bootstrap.config), 6);
    });
    it('重复执行不会覆盖已有文件', () => {
        useHome();
        const dir = tempDir();
        const first = scaffoldConfig(dir);
        assert.ok(first.written.length > 0);
        const second = scaffoldConfig(dir);
        assert.deepEqual(second.written, []);
        assert.ok(second.skipped.length > 0);
    });
    it('--force 覆盖已有文件', () => {
        useHome();
        const dir = tempDir();
        scaffoldConfig(dir);
        const third = scaffoldConfig(dir, true);
        assert.ok(third.written.length > 0);
        assert.deepEqual(third.skipped, []);
    });
    it('目标本身是 config 目录时归位到包根', () => {
        useHome();
        const dir = tempDir();
        const first = scaffoldConfig(path.join(dir, 'config'));
        assert.equal(first.packageRoot, dir);
        assert.equal(first.configDir, path.join(dir, 'config'));
    });
});
