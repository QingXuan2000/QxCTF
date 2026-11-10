# QxCTF

QxCTF 是一个 **JavaScript**（ESM，无构建步骤）写的配置驱动**工具箱**：把命令登记进 JSON 菜单，用全屏 TUI 选一个就能跑，跑完立刻看到退出码和输出尾部。前身是 `Universal Tool Framework`（`@qingxuan2000/utf` 2.x），3.0 为完全重写。

渲染层沿用 sd-tui 的**零依赖思路**（字符网格 + alternate screen + CJK 宽度 + 真彩降级 + SGR 鼠标），但配色、布局与交互是按「工具箱」重新设计的：**GitHub Primer 配色连背景一起铺**（画布 / 面板 / 左栏 / 选中行四层）、2 行顶栏、左侧视图 / 工具包两块面板、右侧路径 / 详情 / 工具三块线框。运行时只有 `zod` 一个依赖（管配置校验）。

```
▌ QxCTF 工具箱 1.0.0                                                6 工具   ★ 0   X86_64 · Windows
────────────────────────────────────────────────────────────────────────────────────────────────────
┌─ 视图 ─────────────┐ ┌─ 路径 ────────────────────────────────────────────────────────────────────┐
│▌ ⌂ 主菜单          │ │ 根目录                                                                    │
│  ★ 收藏            │ └───────────────────────────────────────────────────────────────────────────┘
│  ◷ 最近使用        │ ┌─ 详情 ───────────────────────────────────────────────────────── 环境自检 ─┐
│  ⋮ 设置            │ │ · 确认工具链可用：node --version                                          │
└────────────────────┘ │ · 工作目录：C:\Users\…\examples\demo                                      │
                     │ └───────────────────────────────────────────────────────────────────────────┘
                     │ ┌─ 工具 ───────────────────────────────────────────────────────────── 4 项 ─┐
                     │ │常用 ────────────────────────────────────────────────────────────────────  │
                     │ │    1  信息收集                 端口 / 指纹 / HTTP 头                菜单  │
                     │ │▌   2  环境自检                 确认 Node 可用                       执行  │
                     │ │进阶 ────────────────────────────────────────────────────────────────────  │
                     │ │    3  运行时信息（按架构分发…  演示 path 按架构分组                 执行  │
                     │ │    4  等待一会儿（演示中断）   1.5 秒后返回                         执行  │
┌─ 工具包 ──── 0 个 ─┐ │                                                                           │
│ qxctf-demo     1.0.0 │ │                                                                           │
│ ~\…\examples\demo  │ │                                                                           │
│ 2 菜单 · 6 工具    │ │                                                                           │
└────────────────────┘ └───────────────────────────────────────────────────────────────────────────┘
 ↑↓ 移动 · Enter 执行 · 1-9 选号 · / 过滤 · f 收藏 · p 工具包                 2/4   ? 帮助   q 退出
```

> 上面是 `QxCtfTui.snapshot()` 真实渲染的输出（`examples/demo`，100×22 终端）。左栏**视图**面板是 `主菜单 / 收藏 / 最近使用 / 设置` 四个入口，下面是**工具包**面板；右侧是三块线框：**路径**（面包屑，可点击跳转/返回）、**详情**（`menu.json` 的 `detail`）、**工具**（列表铺满剩余高度）。整幅界面只有**一个背景色**（GitHub Primer 的 canvas 色），所有区域靠边框与前景色区分。终端过矮时会自动省略详情框。

## 为「工具箱」做的设计

- **顶栏只写 title 与版本**：左边 `▌ 主菜单 title 版本`（取 `menu.json` 里 `main` 的 `title`，框架名与版本不占顶栏），右边三个 GitHub label 式胶囊 `N 工具` / `★ N` / `X86_64 · Windows`；长路径不在顶栏（右对齐时会自动让位给胶囊）
- **左栏只有两块面板**：`视图`（`⌂ 主菜单` / `★ 收藏` / `◷ 最近使用` / `⋮ 设置`，当前项高亮）贴顶、`工具包`（名称 / 版本 / 路径 / `N 菜单 · M 工具`，点一下打开工具包面板）**贴底**；中间留白，**没有菜单树**；终端太矮时退回无框形式
- **设置是独立页面**（`s` 或点左栏「设置」），按分区排列：`行为`（手动选择架构 / 主题 / 选项详情）与 `配色`（9 个色位 + 恢复默认配色），分区标题不参与选择；`↑↓` 选、`Enter` 切换或填色值、`s` / `Esc` 回主菜单 —— 和工具列表一样是一整页，不弹窗
- **整屏铺满**：画布底色覆盖终端的每一格（顶栏到最后一列、底栏到最后一行），内容框右边框顶到终端最后一列，没有留空边；缩放终端时按新尺寸重排
- **三块直角线框**：路径 / 详情 / 工具各自独立面板（`┌┐└┘`），边界清楚；内容区底部不再有命令条或执行结果
- **面包屑导航**：独立线框里显示当前层级路径，第一段固定是 `根目录`（对应 `main` 菜单），后面依次是各级菜单 title；点击任意上级即刻跳回；键盘用 `b`/`←` 返回、`m`/`→` 回主菜单。列表里不再有 `返回上级` / `返回主菜单` 这类占位选项
- **详情框固定高度**：按终端高度给 1–3 行，切换选项时高度不变，列表不会上下跳动
- **工具是主体**：主视图就是工具清单；菜单不再以树状列表占地方，靠顶部面包屑在层级间跳转，`Tab` / `Shift+Tab` 在「主菜单 / 收藏 / 最近使用 / 设置」四个视图间循环（底栏常驻 `Tab 切视图` 提示）
- **一眼能选**：每行 = 收藏星标 · 编号 · 名称 · 描述 · 类型；`1`–`9` 直接选号，`Enter` 执行，不用记菜单
- **即时过滤**：按 `/` 后**输入即过滤**（匹配名称、描述、编号），`Esc` 清空，`Enter` 保留
- **选项详情可配置**：详情框按 `menu.json` 的 `detail` 显示当前项的用法/参数/注意事项，支持 `{command}`、`{cwd}`、`{arch}` 等占位符；没配 `detail` 时自动显示命令、目录与架构
- **首页干净**：上次执行结果不占首页空间——执行完底栏 toast 报退出码，需要细节时按 `o` 打开只读输出弹层（历史里也留着）
- **收藏 / 最近使用**：`f` 一处收藏，侧栏「收藏」聚合跨菜单的常用工具；「最近使用」按执行时间倒序（存在 `~/.qxctf/favorites.json` 与 `history.json`）
- **收藏与历史按工具包隔离**：键是 `工具包根::菜单::编号`，切换工具包不会串
- **实时输出 + 先清屏**：执行前清空画面、从第 1 行打印横幅与命令（日志不再接在旧画面后面）；子进程输出实时透传，同时保留尾部供 `o` 查看
- 另有：鼠标可用（面包屑/侧栏/行/★/滚轮）、**GitHub 风格深/浅主题**（`t` 即时切换）、中文宽度正确、颜色模式自动降级、非 TTY 回退成 `qxctf list`
- **配色**整套跟 GitHub Primer 对齐，且**整屏只有一个背景色**：深色 `#0d1117`、浅色 `#ffffff`，画布 / 顶栏 / 底栏 / 左栏 / 面板 / 选中行统一用它，层次完全交给边框与前景色（`text / muted / dim` 三档 + `accent` 强调），弹层外框用 `focusBorder` 标焦点；`t` 键实时切换深/浅

## 安装

```bash
npm i -g @qingxuan2000/qxctf
```

要求 Node.js >= 22。

```bash
qxctf init ./my-qxctf-pack      # 生成一套示例工具包（config/menu.json 等）
qxctf config ./my-qxctf-pack    # 设为当前工具包并持久化
qxctf                         # 打开 TUI
```

首次启动若还没有配置，TUI 会让你输入工具包目录；确认后会同时写入当前配置（`config_path.json`）并登记到工具包列表（`tool_packages.json`），之后按 `p` 就能看到并随时切回。

开发态（纯 JS，无构建步骤）：

```bash
npm install
node src/cli.js             # 或 npm start / npm run dev（--watch）
```

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
| `b` 或 `←` | 返回上级菜单 |
| `m` 或 `→` | 回到主菜单 |
| `a` | 手动指定架构后执行 |
| `s` | 设置页（手动选择架构 / 主题 / 选项详情），再按 `s` 或 `Esc` 返回 |
| `p` | 工具包面板（`a` 添加路径，`d` 移除，`Enter` 切换） |
| `d` | 环境自检（10 项检查） |
| `o` | 上次执行的完整输出 |
| `r` | 重新读取配置文件 |
| `t` | 深色 / 浅色主题切换 |
| `?` | 快捷键帮助 |
| `Esc` | 返回上级菜单（有过滤时先清过滤，再有 toast 时先清提示）；设置页里返回主菜单；弹层里关闭弹层 |
| `q` / `Ctrl+C` | 退出 |

鼠标：点**面包屑**任意上级跳转、点左栏「收藏」「最近使用」切视图、点工具行选中（再点一次执行）、点 ★ 列收藏、滚轮滚动、点底栏 `? 帮助` / `q 退出`。

## CLI

| 命令 | 说明 |
| --- | --- |
| `qxctf` | 启动 TUI；非 TTY 或 CI 环境下自动改为打印菜单树 |
| `qxctf run <目标>` | 直接执行工具。目标写法：`menu:id`、`id`、名称片段 |
| `qxctf list [--json]` | 打印菜单树（`--json` 附带每个可执行项的解析后命令） |
| `qxctf path` | 打印配置目录 / 工具包根 / 数据目录 |
| `qxctf doctor [--json]` | 环境自检（10 项，含脚本路径可达性；失败返回退出码 1） |
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

示例：

```bash
qxctf list
qxctf run main:3 --dry-run --arch ARM64
qxctf run 扫描器
qxctf doctor --json
```

`qxctf run` 会把子进程退出码原样返回，可直接嵌进脚本：

```bash
if qxctf run main:5 >/dev/null; then echo ok; else echo "失败：$?"; fi
```

## 配置格式

工具包目录结构：

```
my-qxctf-pack/
├── config/
│   ├── menu.json           # 必需：菜单树 + 架构选项来源
│   └── settings.json       # 可选：名称、版本、主题、架构选择器开关
└── tools/                  # 工具二进制放这里，menu.json 用相对路径引用
```

只有两个配置文件。架构选择器的选项不再是单独文件——`menu.json` 里凡是 `path` 写成架构映射的项，它的键就是可选架构，运行时自动汇总。

配置目录既可以是 `my-qxctf-pack/config`，也可以直接把 `menu.json` 放在被指定的目录里；`qxctf config` 两种写法都接受。

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

`type` 可以完全省略：有 `submenu` 就是子菜单，有 `path` 就是可执行项；`id` 在同层唯一、`name` 是显示名，其余字段按需添加。

**分区（可选）**：默认平铺，不分组。确实需要分组时，`items` 里的条目可以套一层 `"分区名": [ ... ]`，同组条目上方会画一行分区标题（`常用 ─────`），分区标题不参与选择、数字选号只认条目本身的 `id`：

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

分区的值必须是数组，条目字段校验与普通条目完全一致；写错时报错路径会精确到 `menu.main.items.0.常用.0.detail`。分区顺序、分区内顺序都按配置顺序展开，且可以被 `1`–`9` 数字键与过滤照常命中。

菜单节点字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 面板标题，可含 `\n`；留空则显示菜单 ID |
| `parent` | string | 逻辑父菜单（面包屑/回退用，导航靠栈实现） |
| `items` | array | 菜单项列表；条目可以是普通菜单项，也可以是 `"分区名": [条目...]` 的分区 |

菜单项字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | number | 同层唯一编号，TUI 显示在行首，数字键可直达 |
| `name` | string | 显示名；`qxctf run <名称片段>` 也按此匹配 |
| `type` | `submenu` / `executable` / `back` / `main` | 省略时按字段推断：有 `submenu` → `submenu`，有 `path` → `executable`。`back` / `main` 是旧版导航项，**仍兼容解析但不再显示**（导航交给面包屑） |
| `submenu` | string | `type=submenu` 时目标菜单 ID（必须存在） |
| `path` | string \| object | `type=executable` 时命令；对象形式按架构键分发 |
| `args` | string[] | 追加参数，含空格的参数自动加引号 |
| `cwd` | string | 相对工具包根的工作目录，默认工具包根 |
| `desc` | string | 列表行里的说明文字 |
| `detail` | string \| string[] | 面包屑下方的「选项详情」内容，支持占位符，见下节 |

校验规则（任一不满足即启动失败并报出位置）：必须有 `main` 菜单；同层 `id` 不重复；`submenu` 目标存在；`executable` 的 `path` 非空；`cwd` 不为空串；`detail` 必须是字符串或字符串数组。

### 选项详情（detail）

面包屑的线框正下方是**独立的详情线框**，显示当前选中项的详情，内容由 `menu.json` 的 `detail` 决定（当前项的命令也在这里呈现）：

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
- **占位符**（运行时替换，未命中的占位符原样保留）：

  | 占位符 | 含义 |
  | --- | --- |
  | `{command}` | 解析后的完整命令（含 `args`、命中架构） |
  | `{cwd}` | 子进程工作目录（绝对路径） |
  | `{arch}` | 命中的架构键；单条命令时为 `通用` |
  | `{name}` / `{id}` | 菜单项名称 / 编号 |
  | `{menu}` | 所属菜单 ID |
  | `{type}` | 类型标签：执行 / 菜单 / 返回 / 主菜单 |
  | `{desc}` | 该菜单项的 `desc` 字段 |

- **没写 `detail` 时的兜底**：可执行项显示命令 / 执行目录 / 架构；子菜单显示目标菜单与项数；`back` / `main` 显示操作说明
- **显示行数随终端高度伸缩**：内容区高度 ≥ 24 行显示 3 行、≥ 16 行显示 2 行、更矮显示 1 行；单行超宽用 `…` 截断（想换行就在配置里拆成多条）

### settings.json

新版只保留 5 个短字段（外加可选的 `colors`），全部可选，用不到的就不写：

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

### 自定义配色（colors）

深色与浅色**各自一套**，互不影响；没配置、写错色值、或者只写一部分，都按色位回落到内置的 GitHub Primer 配色：

```json
{
  "theme": "light",
  "colors": {
    "dark":  { "accent": "#ff8800", "base": "#101820" },
    "light": { "accent": "#0055ff", "panel": "#f2f5f9" }
  }
}
```

- 可覆盖的色位：`accent` `accent2` `title` `text` `muted` `dim` `border` `borderSoft` `focusBorder` `base` `good` `warn` `bad`（`base` 是整屏唯一背景色）
- 值必须是 `#rrggbb`；非法键与非法值一律忽略（不报错，继续用默认色）
- **在界面里改**：`s` 打开设置页 → 后 9 项是常用色位（强调 / 标题 / 正文 / 次要 / 线框 / 背景 / 成功 / 警告 / 错误），`Enter` 打开输入框、填 `#rrggbb` 回车即写入 `settings.json`（清空输入 = 该色位恢复默认）；改完立刻生效，写的是**当前主题**那一套
- 设置页最后一行的「重置配色」清掉当前主题的全部自定义，回到内置配色

**旧版写法仍然兼容**（`app` / `settings` 嵌套），会被自动归一化：

```json
{
  "app": { "name": "qxctf-demo", "version": "1.0.0" },
  "settings": { "arch_picker": true, "ui_theme": "light", "color_mode": "256" }
}
```

已删除的字段（旧配置里出现也不报错，直接忽略）：`logo` / `logo.display_logo` / `logo.logo_path`（不再有 logo 文件）、`settings.display_clear`（TUI 全屏重绘，不需要清屏开关）、`settings.input_method`（固定全键盘 + 鼠标）、`settings.arrow_indicator`（选中行改用 `▌` 竖条，不再可配指针）。

### 架构选项从哪来

没有 `arch_picker.json`。只要 `menu.json` 里某项的 `path` 写成架构映射，这些键就是可选架构：

```json
{ "id": 3, "name": "运行时信息", "path": { "X86_64": "tools/info-x64", "ARM64": "tools/info-arm64" } }
```

- 全包汇总、去重后排序：`X86_64 → X86 → ARM64 → ARM32`，其余键按字母序排在后面
- 显示名就是架构键本身；`settings.archPicker: true` 时执行前弹选择器，`a` 键可临时指定
- 一个架构映射都没有时，`a` 键提示「没有按架构分发的命令」，`archPicker` 也不会弹

### 架构匹配顺序

```
用户指定（架构选择器 / --arch） → 系统检测(os.arch) → X86_64 → 配置里第一个非空键
```

`path` 是字符串时视为通用命令，计划里的架构标记为 `default`。用 `qxctf run <目标> --dry-run` 可以直接看到最终选中的命令：

```bash
qxctf run main:3 --dry-run --arch ARM64
# 执行计划
#   架构 ARM64 · node -e "..."  (cwd: .../demo)
```

## 数据目录

| 内容 | 路径 |
| --- | --- |
| 数据目录 | `$QXCTF_HOME`，默认 `~/.qxctf` |
| 当前配置目录 | `~/.qxctf/config_path.json` |
| 工具包注册表 | `~/.qxctf/tool_packages.json` |
| 收藏 | `~/.qxctf/favorites.json`（`工具包根::菜单::编号` 列表） |
| 执行历史 | `~/.qxctf/history.json`（最近 60 条，含退出码、耗时、输出尾部） |

`QXCTF_HOME` 可覆盖数据目录（测试与多环境切换都用它；`CTF_HOME` 仍然兼容）。首次运行时若 `~/.qxctf` 不存在而 `~/.ctf` 或 `~/.ut-framework` 存在，会整目录复制一次完成迁移。收藏与历史损坏时按空处理，不影响启动。

## 从 2.x 迁移

| 2.x | 3.0 |
| --- | --- |
| 包名 `@qingxuan2000/utf` | `@qingxuan2000/qxctf` |
| 命令 `utf` | 命令 `qxctf` |
| `index.js` + `src/*.js`（CommonJS） | `src/**/*.js`（ESM，纯 JavaScript，无构建步骤） |
| 数据目录 `~/.ut-framework` | `~/.qxctf`（首次运行自动复制） |
| 数字输入 / 方向键二选一 | 全屏 TUI：方向键 + 数字选号 + 即时过滤 + 鼠标 |
| readline 逐行刷新界面 | 字符网格渲染层：alternate screen、CJK 宽度、真彩降级、鼠标事件 |
| 列表里的「返回上级 / 返回主菜单」菜单项 | 顶部面包屑（可点击）+ `b`/`←`、`m`/`→`；旧配置里的 `back`/`main` 项仍兼容但不显示 |
| `settings.json` 的 `app` / `settings` / `logo` 嵌套 | 新增扁平写法（`name` / `version` / `theme` / `color` / `archPicker`）；旧嵌套仍兼容，`logo` 字段忽略 |
| `arch_picker.json` | **已删除**：架构选项改为从 `menu.json` 的架构分发键自动汇总 |
| `logo` 文件 | **已删除**：TUI 改为线框布局，不再渲染 ASCII 横幅 |

> 3.0 期间的项目名变更：2.x 是 `utf` → 3.0 曾用 `ctf` → 现统一为 **`qxctf`**（产品名 `QxCTF`，包名 `@qingxuan2000/qxctf`，命令 `qxctf`，数据目录 `~/.qxctf`，环境变量 `QXCTF_HOME`）。数据目录会自动从 `~/.ctf` / `~/.ut-framework` 复制迁移。
| `menu.json` | **格式完全兼容**，无需改写 |

旧配置里可以删掉的字段：`settings.display_clear`、`settings.input_method`、`settings.arrow_indicator`（出现也不报错，直接忽略）；`menu.json` 里的 `type` 字段也可以删（有 `submenu` / `path` 就够）。

## 示例与测试夹具

| 目录 | 用途 |
| --- | --- |
| `examples/demo/` | `qxctf init examples/demo` 生成的示例包：2 个菜单 / 6 个菜单项（平铺，不分组），命令只依赖本机 `node`，示例都只读本地信息、不访问网络 |
| `examples/fake-tools/` | 纯假工具集：10 个 `node` 脚本覆盖 args 引用、架构映射、cwd、退出码、三级菜单、故意缺失的脚本、Unicode 输出、慢工具、交互式 stdin |

```bash
qxctf config examples/fake-tools
qxctf list                    # 3 个菜单 / 10 个可执行项
qxctf doctor                  # 「命令可达性」应报 ghost.js 缺失（WARN，不影响 ok）
qxctf run main:1              # args 里含空格的中文参数会被正确引用
qxctf run main:4; echo $?     # 退出码 4 原样透传
qxctf run main:2 --arch ARM64 --dry-run
```

假工具集全部无副作用（只打印信息），可直接在 TUI 里随便点。

## 项目结构

```
src/
├── cli.js                  # 入口：参数解析、子命令分发、TUI 启动
├── index.js                # 程序化 API 导出
├── version.js              # 版本常量（与 package.json 由测试对齐）
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
│   ├── paths.js            # 数据目录、路径解析、旧版迁移
│   ├── scaffold.js         # qxctf init 的模板生成
│   └── store.js            # 收藏与执行历史（最近使用）
├── ui/                     # 零依赖终端套件（5 个文件）
│   ├── width.js            # CJK/emoji 显示宽度、截断、补白、换行
│   ├── screen.js           # 字符单元网格、面板、命中区域、ANSI 渲染
│   ├── theme.js            # GitHub 风格深/浅主题、自定义配色、颜色模式探测
│   └── input.js            # 鼠标/聚焦序列解析 + 增量输入解码（喂给 readline）
└── tui/
    ├── app.js              # 控制器：状态、键盘/鼠标、渲染循环、终端移交
    ├── model.js            # TuiState、菜单树、几何、设置页分区
    ├── chrome.js           # 顶栏（title + 胶囊）/ 左侧两面板 / 底栏 / 弹层外框
    └── views.js            # 工具列表视图（面包屑 + 详情 + 工具行）/ 设置页 / 弹层
tests/                      # node:test 用例（按模块分文件）+ helpers/ 夹具
examples/demo/              # `qxctf init examples/demo` 生成的可运行示例包
examples/fake-tools/        # 假工具集：覆盖各条执行链路的测试夹具
```

仓库根只留 `package.json` / `package-lock.json` / `README.md` / `LICENSE` / `.gitignore` / `src` / `tests` / `examples`；没有构建脚本、没有产物目录、没有打包缓存。

设计要点：纯 ESM JavaScript，没有编译步骤，`src/` 就是发布产物。`core/` 只依赖 `fs` / `child_process`；`ui/` 是纯渲染，不认业务；`tui/app.js` 只管「状态 + 输入 → 一帧」。三个层次没有循环依赖，TUI 渲染是纯函数式的，所以导航、渲染、配置校验都能脱离终端单测。

## 开发与测试

```bash
npm start            # node src/cli.js
npm run dev          # node --watch src/cli.js
npm test             # node --test --test-isolation=none tests/
npm run test:isolated # 每个测试文件独立进程
```

`npm test` 直接跑 `node --test --test-isolation=none tests/`：源码就是 JS，没有编译步骤，也不依赖 tsx/esbuild 常驻进程，在受限环境（沙箱、CI 容器）里也能跑。测试覆盖：

- 菜单栈进出、面包屑、菜单项动作映射、目标表达式解析
- `menu.json` 的结构与语义校验（含 BOM、非法 JSON、重复 id、悬空 submenu）
- `settings.json` 扁平写法与旧嵌套兼容、已删字段被忽略、架构选项汇总顺序
- 执行计划的架构优先级、参数引用、cwd 解析、真实子进程退出码
- 工具包注册表去重 / 增删 / 损坏文件降级、配置目录持久化
- 收藏与历史：切换 / 去重 / 按工具包隔离 / 时间排序 / 损坏文件降级
- `qxctf init` 生成物可加载、重复执行不覆盖、`--force` 覆盖
- TUI：直接构造 `QxCtfTui`，用 `snapshot()` 取纯文本帧断言界面，用 `handleKeypress` / `handleMouse` 驱动交互——覆盖渲染、数字选号、子菜单进出、Tab 切菜单、即时过滤、收藏与收藏视图、最近使用视图、执行结果（toast + `o` 弹层，且首页不残留上次结果）、帮助/自检/工具包/架构弹层、主题切换、鼠标（侧栏/行/★/底栏/滚轮）、窄终端与首次运行

键盘与鼠标都走真实事件路径（`handleKeypress('\r', {name:'return'})`、1-based 鼠标坐标），不需要 pty。

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

## 许可证

MIT License · Copyright (c) 2025 QingXuanJun
