/**
 * 示例配置生成
 *
 * `qxctf init <目录>` 写入一套最小可用工具包：只有 `config/menu.json` 与 `config/settings.json`。
 * 架构选项从 menu.json 里的架构分发键自动汇总，因此不需要额外配置文件。
 * 模板内嵌在代码里而不是读仓库文件，这样 npm 全局安装后 init 依然可用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { QxCtfError } from './errors.js';
/**
 * menu.json：只写必要字段
 *
 * `type` 可省略（有 submenu 即子菜单、有 path 即可执行）；
 * 条目外面套一层 `"分区名": [ ... ]` 就成组显示，分组标题由 TUI 绘制。
 */
const MENU = {
    menu: {
        main: {
            title: 'QxCTF 工具箱',
            items: [
                {
                    id: 1,
                    name: '信息收集',
                    submenu: 'recon',
                    desc: '本机信息示例',
                    detail: ['进入「信息收集」菜单', '示例只读本机信息，不访问网络'],
                },
                {
                    id: 2,
                    name: '环境自检',
                    path: 'node --version',
                    desc: '确认 Node 可用',
                    detail: ['确认工具链可用：{command}', '工作目录：{cwd}'],
                },
                {
                    id: 3,
                    name: '运行时信息（按架构分发）',
                    path: {
                        X86_64: 'node -e "console.log(\'x86_64\', process.version)"',
                        X86: 'node -e "console.log(\'x86\', process.version)"',
                        ARM64: 'node -e "console.log(\'arm64\', process.version)"',
                        ARM32: 'node -e "console.log(\'arm32\', process.version)"',
                    },
                    desc: '演示 path 按架构分组',
                    detail: ['当前命中架构：{arch}', '命令：{command}'],
                },
                {
                    id: 4,
                    name: '等待一会儿（演示中断）',
                    path: 'node -e "setTimeout(()=>{}, 1500)"',
                    desc: '1.5 秒后返回',
                    detail: ['执行期间终端交给子进程', '结束后按任意键回到界面'],
                },
            ],
        },
        recon: {
            title: '信息收集',
            parent: 'main',
            items: [
                {
                    id: 1,
                    name: '示例：系统信息',
                    path: 'node -e "console.log(process.platform, process.arch)"',
                    desc: '只读本地信息',
                    detail: ['命令：{command}', '不访问网络'],
                },
                {
                    id: 2,
                    name: '示例：本地时间',
                    path: 'node -e "console.log(new Date().toISOString())"',
                    desc: '打印当前时间',
                    detail: ['命令：{command}'],
                },
            ],
        },
    },
};
/** settings.json：扁平短字段，只有用得到的几项 */
const SETTINGS = {
    name: 'qxctf-demo',
    version: '1.0.0',
    theme: 'dark',
    color: 'auto',
    archPicker: false,
};
/** 判定目标目录应使用哪个配置目录（不要求已存在） */
function scaffoldConfigDir(target) {
    const abs = path.resolve(target);
    if (path.basename(abs) === 'config') {
        return { packageRoot: path.dirname(abs), configDir: abs };
    }
    // 已存在且本身就是配置目录（含 menu.json）
    if (fs.existsSync(path.join(abs, 'menu.json')) && !fs.existsSync(path.join(abs, 'config'))) {
        return { packageRoot: path.dirname(abs), configDir: abs };
    }
    return { packageRoot: abs, configDir: path.join(abs, 'config') };
}
/**
 * 在目标目录写入示例工具包
 * @param target 目标目录，默认当前目录
 * @param force 覆盖已存在的文件
 */
export function scaffoldConfig(target, force = false) {
    const { packageRoot, configDir } = scaffoldConfigDir(target);
    try {
        fs.mkdirSync(configDir, { recursive: true });
        fs.mkdirSync(path.join(packageRoot, 'tools'), { recursive: true });
    }
    catch (error) {
        throw new QxCtfError(`无法创建目录：${configDir}`, error.message);
    }
    const files = [
        { file: path.join(configDir, 'menu.json'), content: `${JSON.stringify(MENU, null, 2)}\n` },
        { file: path.join(configDir, 'settings.json'), content: `${JSON.stringify(SETTINGS, null, 2)}\n` },
        {
            file: path.join(packageRoot, 'tools', 'README.md'),
            content: '# tools\n\n把工具二进制放在这个目录，然后在 config/menu.json 里用相对路径引用。\n',
        },
    ];
    const written = [];
    const skipped = [];
    for (const entry of files) {
        if (!force && fs.existsSync(entry.file)) {
            skipped.push(entry.file);
            continue;
        }
        fs.writeFileSync(entry.file, entry.content, 'utf8');
        written.push(entry.file);
    }
    return { packageRoot, configDir, written, skipped };
}
