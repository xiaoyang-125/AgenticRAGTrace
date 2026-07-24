/**
 * chunker.ts — 文档切块服务
 *
 * 对外暴露单一函数 chunkText(text): string[]
 * 实现"段落优先 + 长度兜底 + overlap"策略
 */

// ─── 参数常量 ─────────────────────────────────────────────────────────────────

/**
 * 每个最终 chunk（含 overlap）的最大字符数。
 * 800 是一个经验值：足够容纳一个中等长度的知识段落，
 * 同时不会超出 OpenAI text-embedding-3-small 8191 token 限制太多（中文约 2 字/token）。
 */
const MAX_CHUNK_LEN = 800

/**
 * 正文部分的最大字符数，预留 OVERLAP_SIZE 的空间给前缀 overlap。
 * 这样加上 overlap 后，最终 chunk 仍不超过 MAX_CHUNK_LEN。
 */
const BODY_MAX_LEN = 700 // MAX_CHUNK_LEN - OVERLAP_SIZE

/**
 * 过短的 chunk 会优先与相邻 chunk 合并，减少噪声。
 * 50 字符约等于一个短句，过短则语义信息不足，embedding 质量差。
 */
const MIN_CHUNK_LEN = 50

/**
 * 相邻 chunk 共享的最多字符数（从前一个正文末尾取）。
 * overlap 的目的是保留上下文边界信息，避免被切分掉的关键语境完全丢失。
 * 100 字符约覆盖 1~2 个句子，对中文文档来说是合理的滑动窗口。
 */
const OVERLAP_SIZE = 100

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 将文本按句末标点拆分为句子列表。
 *
 * 为什么不直接用 split(/[。！？.!?]/)：
 * - split 会消耗掉分隔符，导致标点丢失，影响阅读质量。
 * - 使用带捕获组的 split 会在结果中留下孤立的标点，需要额外处理。
 * - 当前方案用正则匹配"一段非标点文字 + 可选标点"的组合，保留标点在当前句子末尾，
 *   更符合阅读习惯，也不会在每个 chunk 边界出现孤立标点。
 *
 * 匹配逻辑：[^。！？.!?]+ 匹配正文（一个或多个非句末标点字符），
 * [。！？.!?]* 匹配其后紧跟的零个或多个句末标点（一句话可以以"!!" 结尾）。
 */
function splitIntoSentences(text: string): string[] {
  const matches = text.match(/[^。！？.!?]+[。！？.!?]*/g)
  // 若没有任何标点，整段视为一个句子返回，不丢弃内容
  return matches ?? [text]
}

/**
 * 将一段文字按固定长度 BODY_MAX_LEN 硬切为多个片段。
 *
 * 为什么用 BODY_MAX_LEN 而不是 MAX_CHUNK_LEN：
 * 硬切产生的片段是"正文"，后续还会在前面加 overlap。
 * 若用 800 切正文，加了 overlap 后就会超出 MAX_CHUNK_LEN。
 */
function hardSplit(text: string): string[] {
  const pieces: string[] = []
  let start = 0
  while (start < text.length) {
    pieces.push(text.slice(start, start + BODY_MAX_LEN))
    start += BODY_MAX_LEN
  }
  return pieces
}

// ─── 核心算法 ─────────────────────────────────────────────────────────────────

/**
 * 将句子列表按装箱逻辑合并为正文 chunk（每个不超过 BODY_MAX_LEN）。
 *
 * 装箱策略：贪心算法，将句子依序累积到当前 chunk，
 * 当加入下一句后总长度即将超过上限时，先关闭当前 chunk，再开启新的 chunk。
 * 句子之间用空字符串拼接（标点已在句子末尾），保持自然排版。
 *
 * 为什么不用段落/句子间插入换行符：
 * 换行符会消耗长度，增加噪声，对 embedding 计算影响微乎其微；
 * 与其插入无语义价值的空白，不如保持正文干净。
 *
 * @param sentences 已经过句子切分的句子数组（每个已保留末尾标点）
 * @returns 正文 chunk 列表，每个 chunk 长度不超过 BODY_MAX_LEN
 */
function packSentencesIntoBodyChunks(sentences: string[]): string[] {
  const bodies: string[] = []
  let current = ''

  for (const sentence of sentences) {
    // 如果单句本身就超过 BODY_MAX_LEN，需要先关闭当前 chunk，再对该句进行硬切
    if (sentence.length > BODY_MAX_LEN) {
      if (current.trim()) {
        bodies.push(current.trim())
        current = ''
      }
      // 硬切超长句，每个片段都直接作为独立正文 chunk
      bodies.push(...hardSplit(sentence))
      continue
    }

    // 加入该句后是否会超过上限
    const tentative = current + sentence
    if (tentative.length > BODY_MAX_LEN) {
      // 超限：先关闭当前 chunk，再开新 chunk 存放当前句子
      if (current.trim()) bodies.push(current.trim())
      current = sentence
    } else {
      current = tentative
    }
  }

  // 收尾：把最后一个未关闭的 chunk 推入结果
  if (current.trim()) bodies.push(current.trim())
  return bodies
}

/**
 * 合并过短的正文 chunk。
 *
 * 合并规则：
 * - 从后向前遍历，找到 length < MIN_CHUNK_LEN 的 chunk。
 * - 优先与前一个 chunk 合并；若为首个或合并后超过 BODY_MAX_LEN，则尝试与后一个合并。
 * - 无法合并时保留（单文档短文本情况）。
 *
 * 为什么从后向前遍历：
 * 从前向后处理时，合并后的 chunk 可能再次被判断"过短"进入下一轮，
 * 导致多次遍历；从后向前则每个 chunk 最多被处理一次，逻辑更清晰。
 */
function mergeShortBodies(bodies: string[]): string[] {
  const result = [...bodies]
  let i = result.length - 1

  while (i >= 0) {
    if (result[i].length < MIN_CHUNK_LEN && result.length > 1) {
      // 尝试向前合并
      if (i > 0 && result[i - 1].length + result[i].length <= BODY_MAX_LEN) {
        result[i - 1] = result[i - 1] + result[i]
        result.splice(i, 1)
        i-- // 合并后前一个可能又变短，继续检查
        continue
      }
      // 尝试向后合并
      if (
        i < result.length - 1 &&
        result[i].length + result[i + 1].length <= BODY_MAX_LEN
      ) {
        result[i] = result[i] + result[i + 1]
        result.splice(i + 1, 1)
        // 当前 chunk 已经变大了，不再向前退，正常进入下一次 i--
      }
    }
    i--
  }

  return result
}

/**
 * 在正文列表的基础上，为每个非首 chunk 追加前缀 overlap，生成最终 chunk。
 *
 * 核心要点：
 * 1. overlap 必须从前一个"正文"取末尾，而不是从前一个"最终 chunk"取。
 *    若从最终 chunk 取，会把前一轮的 overlap 再带入当前轮，
 *    导致 chunk[2] 含有 chunk[0] 末尾、chunk[3] 含有 chunk[0] 末尾…
 *    形成指数级重复内容扩散。
 *
 * 2. overlap 只是上下文冗余，不影响当前正文的语义核心，不更新到 bodies 里。
 *
 * 3. 拼接后再检查一次长度，确保不超过 MAX_CHUNK_LEN（正常情况下不可能超，因为
 *    正文 ≤ BODY_MAX_LEN=700，overlap ≤ OVERLAP_SIZE=100，700+100=800）。
 */
function addOverlap(bodies: string[]): string[] {
  return bodies.map((body, i) => {
    if (i === 0) return body // 首个 chunk 无前缀
    const prevBody = bodies[i - 1]
    const overlap = prevBody.slice(-OVERLAP_SIZE)
    const full = overlap + body
    // 防御性截断（理论上不触发）
    return full.length <= MAX_CHUNK_LEN ? full : full.slice(-MAX_CHUNK_LEN)
  })
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 将文档纯文本切分为 chunk 列表。
 *
 * 整体流程：
 * 1. 按段落（连续空行）切分原始文本
 * 2. 对每个段落，依长度决定走"整段装箱"还是"句子装箱"
 * 3. 合并过短的正文 chunk
 * 4. 追加 overlap，生成最终 chunk 列表
 *
 * @param text 已经过 parser.ts 处理的纯文本（无 Markdown 标记，换行符已统一）
 * @returns 最终 chunk 文本数组（已含 overlap），空文本返回 []
 */
export function chunkText(text: string): string[] {
  // ① 空文本快速返回，路由层将其视为解析失败
  if (!text.trim()) return []

  // ② 按连续空行切段落；filter 去掉空白段落
  // 为什么用 \n\n+ 而非 \n\n：多个连续空行只拆一次，避免产生空字符串
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim())

  // ③ 对每个段落进行处理，收集所有"正文 chunk"
  const allBodies: string[] = []

  for (const para of paragraphs) {
    const trimmed = para.trim()

    if (trimmed.length <= BODY_MAX_LEN) {
      // 短段落：可以整段装入 allBodies，让后续 packSentences 统一处理
      // 但这里先把每个短段落当作"一个句子"传给装箱函数，
      // packSentencesIntoBodyChunks 会将相邻短段落累积到同一个 body chunk
      allBodies.push(trimmed)
    } else {
      // 长段落：先按句子切分，再装箱
      const sentences = splitIntoSentences(trimmed)
      allBodies.push(...packSentencesIntoBodyChunks(sentences))
    }
  }

  // ④ 把相邻短段落合并（短段落此时是 allBodies 中的独立元素，需要再装箱一次）
  //    注意：上一步把短段落逐个 push，没有做跨段落的合并，
  //    所以需要再过一次 packSentencesIntoBodyChunks 才能把短段落累积
  const bodies = mergeShortBodies(packSentencesIntoBodyChunks(allBodies))

  // ⑤ 追加 overlap，生成最终 chunk
  return addOverlap(bodies)
}
