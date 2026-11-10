import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PRODUCT, VERSION } from '../src/version.js';
import { repoRoot } from './helpers/fixtures.js';
describe('版本一致性', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    it('src/version.js 与 package.json 同步', () => {
        assert.equal(VERSION, pkg.version);
    });
    it('包名与 bin 直接指向 JS 入口', () => {
        assert.equal(pkg.name, '@qingxuan2000/qxctf');
        assert.equal(pkg.bin?.['qxctf'], 'src/cli.js');
        assert.equal(pkg.main, './src/index.js');
        // 纯 JS：没有构建步骤，也不需要 TypeScript 依赖
        assert.equal(pkg.scripts?.build, undefined);
        assert.equal(pkg.devDependencies?.typescript, undefined);
    });
    it('产品名固定为 QxCTF', () => {
        assert.equal(PRODUCT, 'QxCTF');
    });
});
