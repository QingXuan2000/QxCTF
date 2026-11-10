# QxCTF

**配置驱动的命令行工具箱**。把命令登记进一份 JSON 菜单，用全屏 TUI 选一个就能跑；跑完立刻拿到退出码、耗时与输出尾部。

- 纯 **JavaScript**（ESM），**无构建步骤** —— `src/` 就是发布产物
- 运行时只有一个依赖：**zod**（只用于配置校验）
- 自带零依赖终端渲染层：字符网格、alternate screen、CJK/emoji 宽度、真彩→256→16 降级、SGR(1006) 鼠标
- 一份 `menu.json` 描述工具与层级，一份 `settings.json` 描述外观与行为
- 内置多架构分发：同一个工具按 `X86_64 / X86 / ARM64 / ARM32` 命中不同命令

```
▌ QxCTF 工具箱 1.0.0                                              6 工具   ★ 0   X86_64 · Windows
────────────────────────────────────────────────────────────────────────────────────────────────────
┌─ 视图 ── Tab 切换 ─┐ ┌─ 路径 ────────────────────────────────────────────────────────────────────┐
│▌ ⌂ 主菜单          │ │ 根目录                                                                    │
│  ★ 收藏            │ └───────────────────────────────────────────────────────────────────────────┘
│  ◷ 最近使用        │ ┌─ 详情 ───────────────────────────────────────────────────────── 环境自检 ─┐
│  ⋮ 设置            │ │ · 确认工具链可用：node --version                                          │
└────────────────────┘ │ · 工作目录：C:\Users\…\examples\demo                                      │
                     │ └───────────────────────────────────────────────────────────────────────────┘
                     │ ┌─ 工具 ───────────────────────────────────────────────────────────── 4 项 ─┐
                     │ │    1  信息收集                 本机信息示例                         菜单  │
                     │ │▌   2  环境自检                 确认 Node 可用                       执行  │
                     │ │    3  运行时信息（按架构分发…  演示 path 按架构分组                 执行  │
                     │ │    4  等待一会儿（演示中断）   1.5 秒后返回                         执行  │
                     │ │                                                                           │
                     │ │                                                                           │
┌─ 工具包 ──── 0 个 ─┐ │                                                                           │
│ qxctf-demo   1.0.0 │ │                                                                           │
│ ~\Docume…ples\demo │ │                                                                           │
│ 2 菜单 · 6 工具    │ │                                                                           │
└────────────────────┘ └───────────────────────────────────────────────────────────────────────────┘
 ↑↓ 移动 · Enter 执行 · Tab 切视图 · Esc 返回 · / 过滤 · f 收藏 · p 工具包 ·  2/4   ? 帮助   q 退出
```

> 上面是 `QxCtfTui.snapshot()` 的真实输出（`examples/demo`，100×22 终端）。左栏贴顶是**视图**面板（`主菜单 / 收藏 / 最近使用 / 设置`），贴底是**工具包**面板；右侧自上而下是**路径**（面包屑，可点击跳转）、**详情**（当前项说明）、**工具**（列表铺满剩余高度）。整屏只有一个背景色，层次全部交给边框与前景色。

---

## 目录

- [快速开始](#快速开始)
- [界面设计](#界面设计)
- [快捷键](#快捷键)
- [命令行](#命令行)
- [配置格式](#配置格式)
  - [menu.json](#menujson)
  - [选项详情 detail](#选项详情-detail)
  - [settings.json](#settingsjson)
  - [自定义配色](#自定义配色)
  - [架构分发](#架构分发)
- [数据目录](#数据目录)
- [示例工具包](#示例工具包)
- [项目结构](#项目结构)
- [开发](#开发)
- [程序化使用](#程序化使用)
- [许可证](#许可证)

---

## 快速开始

要求 **Node.js >= 22**。

```bash
npm i -g @qingxuan2000/qxctf

qxctf init ./my-qxctf-pack      # 生成一套示例工具包（config/menu.json 等）
qxctf config ./my-qxctf-pack    # 设为当前工具包并持久化
qxctf                           # 打开 TUI
```

首次启动若还没有配置，TUI 会提示输入工具包目录；确认后同时写入当前配置（`config_path.json`）并登记到工具包列表（`tool_packages.json`），之后按 `p` 随时切回。

开发态（源码即产物，无需编译）：

```bash
npm install
node src/cli.js             # 等价于 npm start
npm run dev                 # node --watch src/cli.js
```

---

## 界面设计

**顶栏**：左侧是主菜单的 `title` 与版本（`▌ QxCTF 工具箱 1.0.0`），右侧是三枚状态胶囊 —— 工具总数、收藏数、当前架构与系统。框架名不占顶栏。

**左栏**：只有两块面板。`视图` 贴顶（`⌂ 主菜单` / `★ 收藏` / `◷ 最近使用` / `⋮ 设置`，当前项高亮，面板右上角常驻 `Tab 切换` 提示），`工具包` 贴底（名称 / 版本 / 路径 / `N 菜单 · M 工具`，点击打开工具包面板）。中间留白，没有菜单树。

**面包屑**：独立线框，显示当前层级路径，第一段固定 `根目录`，其后是各级菜单 title。点击任意上级即刻跳回。

**详情框**：高度按终端高度给 1–3 行，切换选项时高度不变，列表不会上下跳动。

**工具列表**：每行 = 收藏星标 · 编号 · 名称 · 描述 · 类型徽标。`1`–`9` 直接选号，`Enter` 执行。

**整屏铺满**：画布底色覆盖终端每一格，内容框右边框顶到最后一列，缩放时按新尺寸重排。

**配色**：深色 `#0d1117` / 浅色 `#ffffff` 两套，**整屏只有一个背景色**（`base`），面板、顶栏、底栏、选中行全部共用；层次靠 `text / muted / dim` 三档前景色 + `accent` 强调色 + 边框区分。`t` 键实时切换深浅。

**其它**：即时过滤（`/` 输入即生效，匹配名称/描述/编号）、收藏与最近使用两个聚合视图、主题切换、鼠标操作（面包屑跳转、侧栏切视图、行选中、★ 收藏、滚轮）、非 TTY 环境自动回退成 `qxctf list`。

---

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `↑` `↓` / `j` `k` | 上下移动 |
| `PgUp` `PgDn` / `Home` `End` | 翻页 / 跳首尾 |
| `1`–`9` | 选中该编号的工具 |
| `Enter` | 执行工具 / 进入子菜单 |
| `f` | 收藏 / 取消收藏（★） |
| `/` | 即时过滤（输入即生效，`Esc` 清空） |
| `Tab` / `Shift+Tab` | 在视图间切换：主菜单 → 收藏 → 最近使用 → 设置 |
| `Esc` | 返回上级菜单（有过滤时先清过滤；有提示时先清提示）；设置页里返回主菜单；弹层里关闭弹层 |
| `b` 或 `←` | 返回上级菜单 |
| `m` 或 `→` | 回到主菜单 |
| `a` | 手动指定架构后执行 |
| `s` | 设置页（架构选择器 / 主题 / 选项详情 / 自定义配色），再按 `s` 或 `Esc` 返回 |
| `p` | 工具包面板（`a` 添加路径，`d` 移除，`Enter` 切换） |
| `d` | 环境自检 |
| `o` | 上次执行的完整输出 |
| `r` | 重新读取配置文件 |
| `t` | 深色 / 浅色主题切换 |
| `?` | 快捷键帮助 |
| `q` / `Ctrl+C` | 退出 |

**鼠标**：点面包屑任意上级跳转、点左栏切视图、点工具行选中（再点一次执行）、点 ★ 列收藏、滚轮滚动、点底栏 `? 帮助` / `q 退出`。

---

## 命令行

| 命令 | 说明 |
| --- | --- |
| `qxctf` | 启动 TUI；非 TTY 或 CI 环境下自动改为打印菜单树 |
| `qxctf run <目标>` | 直接执行工具。目标写法：`menu:id`、`id`、名称片段 |
| `qxctf list [--json]` | 打印菜单树（`--json` 附带每个可执行项解析后的命令） |
| `qxctf path` | 打印配置目录 / 工具包根 / 数据目录 |
| `qxctf doctor [--json]` | 环境自检（含脚本路径可达性；失败返回退出码 1） |
| `qxctf packages [list]` | 查看已保存工具包 |
| `qxctf packages add <目录>` / `remove <目录>` | 注册 / 注销工具包 |
| `qxctf config <目录>` | 指定当前工具包（先校验再落盘） |
| `qxctf init [目录] [--force]` | 生成示例工具包 |

全局选项：

| 选项 | 说明 |
| --- | --- |
| `-c, --config <目录>` | 本次使用的工具包目录，覆盖已保存路径 |
| `-a, --arch <架构>` | 指定目标架构：`X86_64` / `X86` / `ARM64` / `ARM32` |
| `-n, --dry-run` | 只打印执行计划，不真正运行 |
| `--json` | 机器可读输出 |
| `--tui` | 非 TTY 下也强制启动 TUI |
| `-f, --force` | `init` 时覆盖已有文件 |
| `-h, --help` / `-v, --version` | 帮助 / 版本 |

```bash
qxctf list
qxctf run main:3 --dry-run --arch ARM64
qxctf run 扫描器
qxctf doctor --json
```

`qxctf run` 把子进程退出码原样返回，可直接嵌进脚本：

```bash
if qxctf run main:5 >/dev/null; then echo ok; else echo "失败：$?"; fi
```

---

## 配置格式

工具包目录结构：

```
my-qxctf-pack/
├── config/
│   ├── menu.json           # 必需：菜单树 + 架构选项来源
│   └── settings.json       # 可选：名称、版本、主题、架构选择器开关
└── tools/                  # 工具放这里，menu.json 用相对路径引用
```

只有两个配置文件。架构选项不再是单独文件 —— `menu.json` 里凡是 `path` 写成架构映射的项，它的键就是可选架构，运行时自动汇总。

配置目录既可以是 `my-qxctf-pack/config`，也可以直接把 `menu.json` 放在被指定的目录里，`qxctf config` 两种写法都接受。

### menu.json

```json
{
  "menu": {
    "main": {
      "title": "QxCTF 工具箱",
      "items": [
        { "id": 1, "name": "信息收集", "submenu": "recon", "desc": "端口 / 指纹" },
        { "id": 2, "name": "环境自检", "path": "node --version" },
        {
          "id": 3,
          "name": "运行时信息",
          "path": { "X86_64": "tools/info-x64.exe", "ARM64": "tools/info-arm64" },
          "args": ["--json"],
          "cwd": "tools"
        }
      ]
    },
    "recon": {
      "title": "信息收集",
      "parent": "main",
      "items": [
        { "id": 1, "name": "系统信息", "path": "node -e \"console.log(process.platform)\"" }
      ]
    }
  }
}
```

`type` 可以完全省略：有 `submenu` 就是子菜单，有 `path` 就是可执行项。`id` 在同层唯一，`name` 是显示名，其余字段按需添加。

**分区（可选）**：默认平铺。确实需要分组时，条目可以套一层 `"分区名": [ ... ]`，同组条目上方会画一行分区标题（`常用 ─────`）；分区标题不参与选择，数字选号只认条目自身的 `id`。

```json
"items": [
  { "常用": [
      { "id": 1, "name": "环境自检", "path": "node --version" },
      { "id": 2, "name": "等待一会儿", "path": "node -e \"setTimeout(()=>{}, 1500)\"" }
  ]},
  { "网络": [
      { "id": 3, "name": "信息收集", "submenu": "recon" }
  ]},
  { "id": 4, "name": "不分组也能混着写", "path": "node --version" }
]
```

分区的值必须是数组，条目字段校验与普通条目完全一致；写错时报错路径精确到 `menu.main.items.0.常用.0.detail`。分区顺序与分区内顺序都按配置顺序展开，数字选号与过滤照常命中。

菜单节点字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 面板标题，可含 `\n`；留空则显示菜单 ID |
| `parent` | string | 逻辑父菜单（面包屑/回退用，导航靠栈实现） |
| `items` | array | 菜单项列表；条目可以是普通菜单项，也可以是 `"分区名": [条目...]` 的分区 |

菜单项字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | number | 同层唯一编号，显示在行首，数字键可直达 |
| `name` | string | 显示名；`qxctf run <名称片段>` 也按此匹配 |
| `type` | `submenu` / `executable` / `back` / `main` | 省略时按字段推断：有 `submenu` → `submenu`，有 `path` → `executable`。`back` / `main` 仍兼容解析但不再显示（导航交给面包屑） |
| `submenu` | string | `type=submenu` 时目标菜单 ID（必须存在） |
| `path` | string \| object | `type=executable` 时命令；对象形式按架构键分发 |
| `args` | string[] | 追加参数，含空格的参数自动加引号 |
| `cwd` | string | 相对工具包根的工作目录，默认工具包根 |
| `desc` | string | 列表行里的说明文字 |
| `detail` | string \| string[] | 详情框内容，支持占位符，见下节 |

**校验规则**（任一不满足即启动失败并报出位置）：必须有 `main` 菜单；同层 `id` 不重复；`submenu` 目标存在；`executable` 的 `path` 非空；`cwd` 不为空串；`detail` 必须是字符串或字符串数组。

### 选项详情 detail

详情框显示当前选中项的说明，内容由 `menu.json` 的 `detail` 决定（当前项的命令也在这里呈现）：

```json
{
  "id": 3,
  "name": "运行时信息（按架构分发）",
  "type": "executable",
  "path": { "X86_64": "node -e \"console.log(process.version)\"" },
  "detail": [
    "按架构键挑命令，当前命中：{arch}",
    "命令：{command}",
    "用 a 键可临时改架构"
  ]
}
```

- **两种写法**：字符串（用 `\n` 分行）或字符串数组，一条 = 一行
- **占位符**（运行时替换，未命中的原样保留）：

  | 占位符 | 含义 |
  | --- | --- |
  | `{command}` | 解析后的完整命令（含 `args`、命中架构） |
  | `{cwd}` | 子进程工作目录（绝对路径） |
  | `{arch}` | 命中的架构键；单条命令时为 `通用` |
  | `{name}` / `{id}` | 菜单项名称 / 编号 |
  | `{menu}` | 所属菜单 ID |
  | `{type}` | 类型标签：执行 / 菜单 / 返回 / 主菜单 |
  | `{desc}` | 该菜单项的 `desc` 字段 |

- **没写 `detail` 时的兜底**：可执行项显示命令 / 执行目录 / 架构；子菜单显示目标菜单与项数
- **显示行数随终端高度伸缩**：内容区 ≥ 24 行显示 3 行、≥ 16 行显示 2 行、更矮显示 1 行；单行超宽用 `…` 截断

### settings.json

只保留几个短字段（外加可选的 `colors`），全部可选，用不到就不写：

```json
{
  "name": "qxctf-demo",
  "version": "1.0.0",
  "theme": "dark",
  "color": "auto",
  "archPicker": false
}
```

| 字段 | 说明 |
| --- | --- |
| `name` / `version` | 工具集名与版本：顶栏、左栏「工具包」面板、`qxctf list` 都用它；缺省用目录名 / `未知版本` |
| `theme` | `dark`（默认）/ `light`；TUI 里按 `t` 可临时切换 |
| `color` | `auto`（默认）/ `truecolor` / `256` / `16` / `none` |
| `archPicker` | `true` 时执行工具前先弹架构选择器（选项由 `menu.json` 的架构键自动汇总） |
| `colors` | 自定义配色，见下节；只写要覆盖的色位，缺的用内置配色 |

### 自定义配色

深色与浅色**各自一套**，互不影响；没配置、写错色值、只写一部分，都按色位回落到内置配色：

```json
{
  "theme": "light",
  "colors": {
    "dark":  { "accent": "#ff8800", "base": "#101820" },
    "light": { "accent": "#0055ff" }
  }
}
```

- 可覆盖的色位：`accent` `accent2` `title` `text` `muted` `dim` `border` `borderSoft` `focusBorder` `base` `good` `warn` `bad`（`base` 是整屏唯一背景色）
- 值必须是 `#rrggbb`；非法键与非法值一律忽略（不报错，继续用默认色）
- **在界面里改**：`s` 打开设置页 → 配色区列出 9 个常用色位，`Enter` 打开输入框、填 `#rrggbb` 回车即写入 `settings.json`（清空输入 = 该色位恢复默认）；改完立刻生效，写的是**当前主题**那一套
- 设置页「恢复默认配色」清掉当前主题的全部自定义

**旧版写法仍然兼容**（`app` / `settings` 嵌套），会被自动归一化：

```json
{
  "app": { "name": "qxctf-demo", "version": "1.0.0" },
  "settings": { "arch_picker": true, "ui_theme": "light", "color_mode": "256" }
}
```

已删除的字段（旧配置里出现也不报错，直接忽略）：`logo` / `logo.display_logo` / `logo.logo_path`、`settings.display_clear`、`settings.input_method`、`settings.arrow_indicator`。

### 架构分发

没有 `arch_picker.json`。只要 `menu.json` 里某项的 `path` 写成架构映射，这些键就是可选架构：

```json
{ "id": 3, "name": "运行时信息", "path": { "X86_64": "tools/info-x64", "ARM64": "tools/info-arm64" } }
```

- 全包汇总、去重后排序：`X86_64 → X86 → ARM64 → ARM32`，其余键按字母序排在后面
- 显示名就是架构键本身；`settings.archPicker: true` 时执行前弹选择器，`a` 键可临时指定
- 一个架构映射都没有时，`a` 键提示「没有按架构分发的命令」，`archPicker` 也不会弹

匹配顺序：

```
用户指定（架构选择器 / --arch） → 系统检测(os.arch) → X86_64 → 配置里第一个非空键
```

`path` 是字符串时视为通用命令，计划里的架构标记为 `default`。用 `--dry-run` 可以直接看到最终选中的命令：

```bash
qxctf run main:3 --dry-run --arch ARM64
# 执行计划
#   架构 ARM64 · node -e "..."  (cwd: .../demo)
```

---

## 数据目录

| 内容 | 路径 |
| --- | --- |
| 数据目录 | `$QXCTF_HOME`，默认 `~/.qxctf` |
| 当前配置目录 | `~/.qxctf/config_path.json` |
| 工具包注册表 | `~/.qxctf/tool_packages.json` |
| 收藏 | `~/.qxctf/favorites.json`（`工具包根::菜单::编号` 列表） |
| 执行历史 | `~/.qxctf/history.json`（最近 60 条，含退出码、耗时、输出尾部） |

`QXCTF_HOME` 可覆盖数据目录（多环境切换时用它）。收藏与历史的键都带工具包根，切换工具包不会串；文件损坏时按空处理，不影响启动。

---

## 示例工具包

| 目录 | 用途 |
| --- | --- |
| `examples/demo/` | `qxctf init examples/demo` 生成的示例包：2 个菜单 / 6 个菜单项（平铺），命令只依赖本机 `node`，示例只读本地信息、不访问网络 |
| `examples/fake-tools/` | 演示用工具集：10 个 `node` 脚本，覆盖 args 引用、架构映射、cwd、退出码、三级菜单、故意缺失的脚本、Unicode 输出、慢工具、交互式 stdin |

```bash
qxctf config examples/fake-tools
qxctf list                    # 3 个菜单 / 10 个可执行项
qxctf doctor                  # 「命令可达性」应报 ghost.js 缺失（WARN，不影响 ok）
qxctf run main:1              # args 里含空格的中文参数会被正确引用
qxctf run main:4; echo $?     # 退出码 4 原样透传
qxctf run main:2 --arch ARM64 --dry-run
```

假工具集全部无副作用（只打印信息），可直接在 TUI 里随便点。
---

## 项目结构

```
src/
├── cli.js                  # 入口：参数解析、子命令分发、TUI 启动
├── index.js                # 程序化 API 导出
├── version.js              # 版本常量（与 package.json 保持一致）
├── core/                   # 零 UI 依赖的核心层
│   ├── arch.js             # 架构/平台识别、候选顺序
│   ├── bootstrap.js        # 启动上下文装配
│   ├── config.js           # menu / settings 加载与校验、架构选项汇总
│   ├── doctor.js           # 环境自检
│   ├── errors.js           # QxCtfError（消息 + 修复提示）
│   ├── executor.js         # 执行计划生成、子进程执行、透传+截尾
│   ├── loader.js           # TUI 与核心层之间的桥
│   ├── menu.js             # 菜单栈、菜单项解析、目标解析（纯函数）
│   ├── packages.js         # 工具包注册表（去重、增删、摘要）
│   ├── paths.js            # 数据目录、路径解析
│   ├── scaffold.js         # qxctf init 的模板生成
│   └── store.js            # 收藏与执行历史（最近使用）
├── ui/                     # 零依赖终端套件
│   ├── width.js            # CJK/emoji 显示宽度、截断、补白、换行
│   ├── screen.js           # 字符单元网格、面板、命中区域、ANSI 渲染
│   ├── theme.js            # 深/浅主题、自定义配色、颜色模式探测
│   └── input.js            # 鼠标/聚焦序列解析 + 增量输入解码
└── tui/
    ├── app.js              # 控制器：状态、键盘/鼠标、渲染循环、终端移交
    ├── model.js            # 视图模型、几何计算、设置页分区
    ├── chrome.js           # 顶栏 / 左侧两面板 / 底栏 / 弹层外框
    └── views.js            # 工具列表视图 / 设置页 / 弹层
examples/demo/              # 可运行的示例工具包
examples/fake-tools/        # 演示用工具集：覆盖各条执行链路
```

仓库根只留 `package.json` / `package-lock.json` / `README.md` / `LICENSE` / `.gitignore` / `src` / `examples`；没有构建脚本、没有产物目录、没有打包缓存。

三层之间没有循环依赖：`core/` 只依赖 `fs` / `child_process`，`ui/` 是纯渲染、不认业务，`tui/app.js` 只管「状态 + 输入 → 一帧」。TUI 渲染是纯函数式的，导航、渲染、配置校验都能脱离真实终端跑。

---

## 开发

```bash
npm install
npm start            # node src/cli.js
npm run dev          # node --watch src/cli.js
```

源码就是运行产物：没有编译步骤，没有 `dist/`，没有类型生成，改完直接刷新终端即可。`src/` 分三层，`core/` 与 `ui/` 之间互不依赖，`tui/` 只做编排。

---

## 程序化使用

```ts
import { loadBootstrap, planExecution, runPlan, resolveTarget, QxCtfTui, VERSION } from '@qingxuan2000/qxctf';

const bootstrap = loadBootstrap({ configDir: './my-qxctf-pack' });
const { item } = resolveTarget(bootstrap.config, 'main:3');
const plan = planExecution(item, { packageRoot: bootstrap.packageRoot, preferredArch: 'ARM64' });

console.log(VERSION, plan.command, plan.cwd);
await runPlan(plan);
```

TUI 也可以当组件用（渲染层是纯数据，可截图/快照）：

```ts
import { createLoader, QxCtfTui } from '@qingxuan2000/qxctf';

const tui = new QxCtfTui({ initial: bootstrap, loader: createLoader() });
console.log(tui.snapshot(110, 30).join('\n')); // 纯文本一帧
// handleKeypress / handleMouse 同样可程序化驱动；tui.run() 才接管真实终端
```

---

## 许可证

MIT License · Copyright (c) 2025 QingXuanJun
