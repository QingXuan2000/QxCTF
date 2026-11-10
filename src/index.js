/**
 * 公共 API
 *
 * 供其他程序化调用：装配上下文、解析菜单、生成执行计划、运行工具。
 * CLI 与 TUI 都建立在这组导出之上，第三方脚本也可以直接用。
 */
export { KNOWN_ARCHES, archCandidates, archFromNodeArch, detectArch, detectOs } from './core/arch.js';
export { chooseConfigDir, loadBootstrap, tryLoadBootstrap } from './core/bootstrap.js';
export { deriveArchOptions, loadMenuConfig, loadSettings, readPackageInfo, resolveSettings, } from './core/config.js';
export { QxCtfError, CtfError, describeError } from './core/errors.js';
export { formatPlan, planExecution, quoteArg, runPlan, runPlanTee } from './core/executor.js';
export { addPackage, listPackages, packageSummary, removePackage } from './core/packages.js';
export { clearHistory, loadFavorites, loadHistory, pushHistory, recentMap, saveFavorites, toggleFavorite, toolKey, } from './core/store.js';
export { MAIN_MENU, actionFor, breadcrumb, createStack, currentMenu, getItem, getMenu, popMenu, pushMenu, resetStack, resolveTarget, } from './core/menu.js';
export { configPathFile, dataDir, packageRootOf, readSavedConfigDir, resolveConfigDir, writeSavedConfigDir } from './core/paths.js';
export { runDoctor } from './core/doctor.js';
export { createLoader } from './core/loader.js';
export { PRODUCT, TAGLINE, VERSION } from './version.js';
// TUI：控制器 + 零依赖渲染套件（可单独复用）
export { QxCtfTui, CtfTui, createTui } from './tui/app.js';
export { geometryFor, navEntries } from './tui/model.js';
export { Screen } from './ui/screen.js';
export { THEMES, detectColorMode, resolveTheme } from './ui/theme.js';
export { charWidth, clipText, padEndWidth, padStartWidth, strWidth, truncateMiddle, wrapText } from './ui/width.js';
export { MOUSE_DISABLE, MOUSE_ENABLE, createInputDecoder, parseFocus, parseMouse } from './ui/input.js';
