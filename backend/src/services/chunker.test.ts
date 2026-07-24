/**
 * chunker.test.ts — chunkText 行为测试
 *
 * 使用 vitest（与 vite 同生态，无需 babel，TypeScript 原生支持）。
 * 测试覆盖 spec 中要求的 7 个验收场景。
 */

import { describe, it, expect } from 'vitest'
import { chunkText } from './chunker'

// ─── 常量（与 chunker.ts 保持一致，避免魔法数字） ─────────────────────────────
const MAX = 800
const OVERLAP = 100

// ─── 辅助工具 ─────────────────────────────────────────────────────────────────

/** 生成 n 个中文字符的字符串（用汉字"字"填充） */
function chars(n: number, ch = '字'): string {
  return ch.repeat(n)
}

/** 在 n 个字符内随机取一个句子（末尾带句号） */
function sentence(n: number): string {
  return chars(n - 1) + '。'
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe('chunkText', () => {
  // 1. 空白文本返回空数组
  it('空文本返回 []', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   ')).toEqual([])
    expect(chunkText('\n\n\n')).toEqual([])
  })

  // 2. 短文档（整体小于 MIN_CHUNK_LEN）仍可作为单个 chunk 返回
  it('整篇内容很短时，仍返回单个 chunk', () => {
    const short = '这是一段很短的文字。'
    const chunks = chunkText(short)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toBe(short)
  })

  // 3. 多个短段落按段落优先合并到同一 chunk
  it('多个短段落合并到同一 chunk 中', () => {
    // 每个段落 10 字，三段合计 30 字，远小于 700，应合并为 1 个 chunk
    const text = [chars(10), chars(10), chars(10)].join('\n\n')
    const chunks = chunkText(text)
    // 合并后 chunk 数量应小于段落数
    expect(chunks.length).toBeLessThan(3)
    // 合并后的 chunk 应包含所有内容
    const combined = chunks.join('')
    expect(combined).toContain(chars(10))
  })

  // 4. 超长段落按句子切分
  it('超长段落按句子边界切分，不产生超限 chunk', () => {
    // 20 个句子，每句 50 字 + 句号 = 51 字，共 1020 字，超过 700 需切分
    const longPara = Array.from({ length: 20 }, () => sentence(51)).join('')
    const chunks = chunkText(longPara)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX)
    }
  })

  // 5. 超长单句按固定长度切分
  it('超长单句（无标点）被硬切，每片不超过 MAX_CHUNK_LEN', () => {
    // 1500 字、无任何标点的长字符串（模拟代码块或无标点外文）
    const longSentence = chars(1500)
    const chunks = chunkText(longSentence)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX)
    }
  })

  // 6. 每个最终 chunk 不超过 MAX_CHUNK_LEN
  it('所有 chunk 长度不超过 800', () => {
    // 构造一个包含多种情况的综合文本
    const text = [
      // 超长段落（包含多个句子）
      Array.from({ length: 15 }, () => sentence(60)).join(''),
      // 多个短段落
      chars(30),
      chars(20),
      chars(15),
      // 超长无标点段落
      chars(900),
    ].join('\n\n')

    const chunks = chunkText(text)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX)
    }
  })

  // 7. overlap：非首 chunk 的前缀来自前一个正文末尾（最多 OVERLAP_SIZE 字符）
  it('非首 chunk 前缀等于前一个正文末尾最多 100 字符', () => {
    // 构造两个明显不同的段落，使其切出至少 2 个 chunk
    // 第 1 个正文：680 字（接近 BODY_MAX_LEN=700），用 'A' 填充
    // 第 2 个正文：300 字，用 'B' 填充
    const para1 = chars(680, 'A')
    const para2 = chars(300, 'B')
    const text = para1 + '\n\n' + para2

    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThanOrEqual(2)

    // 第 2 个 chunk 应该以 para1 末尾最多 100 个 'A' 开头
    const expectedOverlapLen = Math.min(OVERLAP, para1.length)
    const expectedPrefix = para1.slice(-expectedOverlapLen)
    expect(chunks[1].startsWith(expectedPrefix)).toBe(true)

    // overlap 部分应全是 'A'，正文部分应全是 'B'
    expect(chunks[1].slice(0, expectedOverlapLen)).toBe(chars(expectedOverlapLen, 'A'))
    expect(chunks[1].slice(expectedOverlapLen)).toBe(para2)
  })

  // 8. overlap 不递归扩散（chunk[2] 不含 chunk[0] 内容）
  it('overlap 不递归扩散到第三个 chunk', () => {
    // 三个段落，每个 680 字，使每个都切出独立 chunk
    const para1 = chars(680, 'A')
    const para2 = chars(680, 'B')
    const para3 = chars(680, 'C')
    const text = [para1, para2, para3].join('\n\n')

    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThanOrEqual(3)

    // chunk[2] 的前缀应该是 para2 末尾（'B'），而不是 para1 末尾（'A'）
    expect(chunks[2].startsWith(chars(OVERLAP, 'B'))).toBe(true)
    // chunk[2] 中不应含有 'A'（para1 的内容）
    expect(chunks[2]).not.toContain('A')
  })
})
