/**
 * 架构与平台识别
 *
 * 配置里的工具路径按架构分组，运行前需要把「当前机器」映射到配置键。
 * 匹配顺序：用户指定 → 系统检测 → X86_64 → 配置中的第一个键。
 * 这个顺序刻意与旧版实现保持一致，保证既有工具包行为不变。
 */
import os from 'node:os';
/** 框架内建的架构键 */
export const KNOWN_ARCHES = ['X86_64', 'X86', 'ARM64', 'ARM32'];
/** Node 的 os.arch() -> 框架架构键 */
export function archFromNodeArch(nodeArch = os.arch()) {
    const value = nodeArch.toLowerCase();
    if (value === 'arm64' || value === 'aarch64') {
        return 'ARM64';
    }
    if (value === 'arm' || value === 'armv7l') {
        return 'ARM32';
    }
    if (value === 'ia32' || value === 'x32') {
        return 'X86';
    }
    if (value === 'x64' || value === 'amd64') {
        return 'X86_64';
    }
    return 'Unknown';
}
/** 当前系统架构 */
export function detectArch() {
    return archFromNodeArch();
}
/** 当前操作系统标签 */
export function detectOs(platform = process.platform) {
    if (platform === 'win32') {
        return 'Windows';
    }
    if (platform === 'linux') {
        return 'Linux';
    }
    if (platform === 'darwin') {
        return 'macOS';
    }
    return platform;
}
/**
 * 生成架构候选顺序。
 * @param preferred 用户显式指定的架构（架构选择器的结果）
 * @param detected 系统检测到的架构
 */
export function archCandidates(preferred, detected = detectArch()) {
    const order = [];
    const push = (value) => {
        if (typeof value === 'string' && value.trim() !== '' && !order.includes(value)) {
            order.push(value);
        }
    };
    push(preferred);
    push(detected);
    push('X86_64');
    return order;
}
/** 架构键的展示名 */
export function archLabel(arch) {
    return arch === 'Unknown' ? '未知架构' : arch;
}
/** 当前机器是否为 Windows（决定默认 shell 提示） */
