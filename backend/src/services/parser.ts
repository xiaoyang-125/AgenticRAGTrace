import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import stripMarkdown from 'strip-markdown'

/**
 * 将 Markdown 字符串解析为可检索的纯文本。
 *
 * 处理步骤：
 *  1. remark-frontmatter：识别并剥离 YAML / TOML frontmatter 块，
 *     使其不出现在最终文本中（frontmatter 是元数据，不是文档正文）。
 *  2. strip-markdown：遍历 AST，移除所有 Markdown 标记符号，
 *     保留标题文字、段落文字、链接文字（丢弃 URL）、代码块内容、图片 alt。
 *  3. 后处理：合并超过两个连续换行，去除首尾空白。
 */
export async function parseMarkdown(raw: string): Promise<string> {
  const file = await remark()
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(stripMarkdown)
    .process(raw)

  return String(file)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 将 TXT 字符串规范化为统一格式的纯文本。
 *
 * 处理步骤：
 *  1. 去除 UTF-8 BOM（U+FEFF）：Windows 记事本保存 UTF-8 时会在文件头写入 BOM，
 *     不去除会导致首行第一个字符是不可见的特殊字符，影响后续切分和展示。
 *  2. CRLF → LF：统一 Windows 换行符。
 *  3. CR → LF：统一旧 Mac 换行符（OS 9 及更早）。
 *  4. trim：去除首尾多余空白。
 */
export function parseTxt(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}
