/**
 * 输出 token 的估算（ticket 05）—— 客户端硬截断的计数依据。
 *
 * 网关只在尾帧报 `completion_tokens`（协议实测 §3.3–§3.6），等它到达再判断上限
 * 已经晚了：不遵守上限的上游（glm 实测 16 → 74 tokens）会先把整段内容发完。
 * 所以硬截断必须边收边估。估算规则刻意保守、可解释：
 *
 * - 中日韩文字、全角符号、假名、谚文与 emoji 按 1 字符 1 token（这些字符在
 *   BPE 里几乎都是一字一 token）；
 * - 换行按 1 token（`\n` 在主流分词器里独立成 token）；
 * - 其余 ASCII 每 3 个字符 1 token（英文约 4 字符/token，短词与标点更密）。
 *
 * 估算只用于「该停了」，不用于计费或展示；上游一旦报出真实用量，就以真实值为准。
 *
 * @module dsh-opendesign-provider/output-tokens
 */

/** 估算里 ASCII 字符折算 token 的密度：3 字符 1 token。 */
const ASCII_CHARS_PER_TOKEN = 3

/** 估算一段增量文本折合多少输出 token（可以是小数，调用方累加后再比较）。 */
export function estimateOutputTokens(text: string): number {
  let tokens = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x2e80 || char === '\n' || char === '\r') tokens += 1
    else tokens += 1 / ASCII_CHARS_PER_TOKEN
  }
  return tokens
}
