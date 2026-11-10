# 演示工具集

用于演示 QxCTF 的各条执行链路，**不产生任何副作用**：所有"工具"都是 `node` 脚本，只打印信息或按指定退出码结束。

| 菜单项 | 工具 | 验证点 |
| --- | --- | --- |
| main:1 打招呼 | `tools/hello.js` | `args` 引用（含空格的中文参数）、默认 cwd |
| main:2 按架构分发 | `tools/arch.js` | `path` 架构映射；架构选项由这些键自动汇总（`archPicker: true`） |
| main:3 相对 cwd | `tools/hello.js` | `cwd: "tools"` 时相对路径可用 |
| main:4 失败退出 | `tools/fail.js 4` | 退出码透传（CLI 退出码 4、TUI 红色状态） |
| main:5 慢工具 | `tools/slow.js 800` | 执行期间终端移交、结束后重绘 |
| main:6 → recon → recon-deep | — | 二级 / 三级菜单、`back` 与 `main` 菜单项 |
| main:7 不存在的工具 | `tools/ghost.js`（故意不存在） | `doctor` 的「命令可达性」告警、运行时错误状态 |
| main:8 Unicode 输出 | `tools/unicode.js` | 中文 / 框线 / 混合宽度输出 |
| main:10 两位编号 | `tools/hello.js` | 两位 id 的行首对齐 |
| recon:2 环境变量摘要 | `tools/env.js` | 子进程 env / cwd 继承 |
| recon-deep:1 回显 stdin | `tools/stdin-echo.js` | 交互式子进程（继承 stdin） |

选项详情（`detail`）：

- `main:1` 用**单行字符串**写详情（验证字符串形式）
- `main:2` / `main:7` / `recon:2` 用**字符串数组** + 占位符（`{arch}`、`{command}`）
- `main:3`（相对 cwd）**故意不写 detail**，用来验证兜底摘要（显示命令 / 执行目录 / 架构）

导航不再靠列表项：顶部面包屑 + `b`/`←`、`m`/`→` 完成返回与跳转，所以菜单里没有 `back` / `main` 导航项。

配置只有两个文件：`config/menu.json` 与 `config/settings.json`（没有 `arch_picker.json`，也没有 `logo`）。

使用方式：

```bash
qxctf config examples/fake-tools   # 设为当前工具包
qxctf list                         # 看菜单树
qxctf doctor                       # 应有一条「命令可达性」WARN：ghost.js 不存在
qxctf run main:1 --dry-run         # 看 args 引用后的最终命令
qxctf run main:4; echo $?          # 退出码应为 4
qxctf                              # 进 TUI 亲手点一遍
```
