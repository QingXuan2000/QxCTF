/**
 * 统一错误类型
 *
 * 所有面向用户的失败都走 QxCtfError：
 * - message 说明发生了什么
 * - hint 给出一条可执行的修复建议
 */
export class QxCtfError extends Error {
    hint;
    constructor(message, hint) {
        super(message);
        this.name = 'QxCtfError';
        if (hint !== undefined) {
            this.hint = hint;
        }
    }
}
/** 旧名别名，保留给已经在用的脚本 */
export const CtfError = QxCtfError;
/** 把任意抛出物转成一行可读文本 */
export function describeError(error) {
    if (error instanceof QxCtfError) {
        return error.hint ? `${error.message}（${error.hint}）` : error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
/** 取错误对象的 hint，没有则返回 undefined */
