import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { QxCtfError } from '../src/core/errors.js';
import { addPackage, canonicalRoot, listPackages, packageSummary, removePackage } from '../src/core/packages.js';
import { readSavedConfigDir, writeSavedConfigDir } from '../src/core/paths.js';
import { makePackage, minimalMenu, tempDir } from './helpers/fixtures.js';
/** 每个用例用独立的 QXCTF_HOME，互不干扰 */
function useHome() {
    const home = tempDir('qxctf-home-');
    process.env['QXCTF_HOME'] = home;
    return home;
}
describe('工具包注册表', () => {
    it('初始为空', () => {
        useHome();
        assert.deepEqual(listPackages(), []);
    });
    it('添加后能读回，且记录自报名称', () => {
        useHome();
        const dir = tempDir();
        makePackage(dir, { menu: minimalMenu, settings: { app: { name: '命名包', version: '9.9.9' } } });
        const packages = addPackage(dir);
        assert.equal(packages.length, 1);
        assert.equal(packages[0]?.name, '命名包');
        assert.equal(listPackages()[0]?.path, dir);
        const record = listPackages()[0];
        assert.ok(record !== undefined);
        const summary = packageSummary(record);
        assert.equal(summary.name, '命名包');
        assert.equal(summary.version, '9.9.9');
        assert.equal(summary.alive, true);
    });
    it('同一工具包的不同路径写法只保留一条', () => {
        useHome();
        const dir = tempDir();
        makePackage(dir, { menu: minimalMenu });
        addPackage(dir);
        addPackage(path.join(dir, 'config'));
        addPackage(path.join(dir, 'config', 'menu.json'));
        assert.equal(listPackages().length, 1);
    });
    it('重复添加只更新名称', () => {
        useHome();
        const dir = tempDir();
        makePackage(dir, { menu: minimalMenu });
        addPackage(dir, '旧名');
        const packages = addPackage(dir, '新名');
        assert.equal(packages.length, 1);
        assert.equal(packages[0]?.name, '新名');
    });
    it('移除后列表变空', () => {
        useHome();
        const dir = tempDir();
        makePackage(dir, { menu: minimalMenu });
        addPackage(dir);
        assert.deepEqual(removePackage(dir), []);
        assert.deepEqual(listPackages(), []);
    });
    it('路径失效时 packageSummary 报失效', () => {
        useHome();
        const dir = tempDir();
        makePackage(dir, { menu: minimalMenu });
        addPackage(dir);
        const record = listPackages()[0];
        assert.ok(record !== undefined);
        const summary = packageSummary({ ...record, path: path.join(dir, 'not-exist') });
        assert.equal(summary.alive, false);
        assert.equal(summary.version, '失效');
    });
    it('非法路径添加时报错', () => {
        useHome();
        assert.throws(() => addPackage(tempDir()), QxCtfError);
    });
    it('注册表文件损坏时退化为空列表', () => {
        const home = useHome();
        fs.writeFileSync(path.join(home, 'tool_packages.json'), '{ broken', 'utf8');
        assert.deepEqual(listPackages(), []);
    });
    it('规范化根目录与路径写法无关', () => {
        useHome();
        const dir = tempDir();
        makePackage(dir, { menu: minimalMenu });
        assert.equal(canonicalRoot(dir), canonicalRoot(path.join(dir, 'config')));
    });
});
describe('当前配置目录', () => {
    it('写入后可读回', () => {
        useHome();
        const dir = tempDir();
        const configDir = makePackage(dir, { menu: minimalMenu });
        writeSavedConfigDir(configDir);
        assert.equal(readSavedConfigDir(), configDir);
    });
    it('失效路径读回 null', () => {
        useHome();
        const dir = tempDir();
        makePackage(dir, { menu: minimalMenu });
        writeSavedConfigDir(path.join(dir, 'ghost'));
        assert.equal(readSavedConfigDir(), null);
    });
});
