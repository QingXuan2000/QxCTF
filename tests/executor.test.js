import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { archCandidates, archFromNodeArch, detectOs } from '../src/core/arch.js';
import { planExecution, quoteArg, runPlan } from '../src/core/executor.js';
import { tempDir } from './helpers/fixtures.js';
const item = (path_, extra = {}) => ({
    id: 1,
    name: '工具',
    type: 'executable',
    path: path_,
    ...extra,
});
const root = path.resolve('/tmp/qxctf-package');
describe('架构映射', () => {
    it('node 架构名转框架键', () => {
        assert.equal(archFromNodeArch('x64'), 'X86_64');
        assert.equal(archFromNodeArch('arm64'), 'ARM64');
        assert.equal(archFromNodeArch('ia32'), 'X86');
        assert.equal(archFromNodeArch('arm'), 'ARM32');
        assert.equal(archFromNodeArch('mips'), 'Unknown');
    });
    it('候选顺序：指定 → 检测 → X86_64', () => {
        assert.deepEqual(archCandidates('ARM64', 'X86_64'), ['ARM64', 'X86_64']);
        assert.deepEqual(archCandidates(null, 'ARM64'), ['ARM64', 'X86_64']);
    });
    it('操作系统标签', () => {
        assert.equal(detectOs('win32'), 'Windows');
        assert.equal(detectOs('linux'), 'Linux');
        assert.equal(detectOs('darwin'), 'macOS');
    });
});
describe('执行计划', () => {
    it('单条命令记为 default 架构', () => {
        const plan = planExecution(item('nmap -sV 10.0.0.1'), { packageRoot: root, detectedArch: 'X86_64' });
        assert.equal(plan.arch, 'default');
        assert.equal(plan.command, 'nmap -sV 10.0.0.1');
        assert.deepEqual(plan.candidates, []);
        assert.equal(plan.cwd, root);
    });
    it('优先使用用户指定架构', () => {
        const plan = planExecution(item({ X86_64: 'tool64', ARM64: 'tool-arm' }), { packageRoot: root, detectedArch: 'X86_64', preferredArch: 'ARM64' });
        assert.equal(plan.arch, 'ARM64');
        assert.equal(plan.command, 'tool-arm');
    });
    it('无指定时使用系统架构', () => {
        const plan = planExecution(item({ X86_64: 'tool64', ARM64: 'tool-arm' }), {
            packageRoot: root,
            detectedArch: 'ARM64',
        });
        assert.equal(plan.arch, 'ARM64');
    });
    it('系统架构缺失时回退 X86_64', () => {
        const plan = planExecution(item({ X86: 'tool32', X86_64: 'tool64' }), {
            packageRoot: root,
            detectedArch: 'Unknown',
        });
        assert.equal(plan.arch, 'X86_64');
    });
    it('没有 X86_64 时取配置里的第一个可用键', () => {
        const plan = planExecution(item({ '': 'empty', ARM32: 'tool-arm32' }), {
            packageRoot: root,
            detectedArch: 'Unknown',
        });
        assert.equal(plan.arch, 'ARM32');
        assert.equal(plan.command, 'tool-arm32');
    });
    it('args 会被安全引用', () => {
        const plan = planExecution(item('tool', { args: ['-o', 'a b.txt'] }), { packageRoot: root });
        assert.equal(plan.command, 'tool -o "a b.txt"');
    });
    it('cwd 相对工具包根解析', () => {
        const plan = planExecution(item('tool', { cwd: 'bin' }), { packageRoot: root });
        assert.equal(plan.cwd, path.resolve(root, 'bin'));
    });
    it('空映射与空命令被拒绝', () => {
        assert.throws(() => planExecution(item({}), { packageRoot: root }), /没有任何非空命令/);
        assert.throws(() => planExecution(item('   '), { packageRoot: root }), /命令为空/);
    });
    it('非可执行项被拒绝', () => {
        const back = { id: 2, name: '返回', type: 'back' };
        assert.throws(() => planExecution(back, { packageRoot: root }), /不是可执行项/);
    });
});
describe('参数引用', () => {
    it('需要时加引号', () => {
        assert.equal(quoteArg('plain'), 'plain');
        assert.equal(quoteArg('a b'), '"a b"');
        assert.equal(quoteArg(''), '""');
        assert.equal(quoteArg('a"b'), '"a\\"b"');
    });
});
describe('真实执行', () => {
    // 用真实存在的临时目录作为 cwd，否则 spawn 会因 cwd 不存在而 ENOENT
    const realRoot = tempDir('qxctf-exec-');
    it('退出码透传', async () => {
        const plan = planExecution(item('node -e "process.exit(7)"'), { packageRoot: realRoot });
        const outcome = await runPlan(plan);
        assert.equal(outcome.code, 7);
    });
    it('成功时退出码为 0', async () => {
        const plan = planExecution(item('node -e "process.exit(0)"'), { packageRoot: realRoot });
        const outcome = await runPlan(plan);
        assert.equal(outcome.code, 0);
    });
});
