/**
 * embedder.ts — OpenAI embedding 生成服务
 *
 * 对外暴露单一函数 embedChunks(texts): Promise<number[][]>
 * 使用 text-embedding-3-small 模型，输出 1536 维向量
 */

import OpenAI from 'openai'

// ─── 参数常量 ─────────────────────────────────────────────────────────────────

/**
 * 单批次最多发送给 OpenAI 的 chunk 数量。
 *
 * 为什么分批而不是一次全部发送：
 * - OpenAI embeddings API 对单次请求的 token 总量有上限（约 8191 token/input）；
 *   虽然 input 是数组，但多条超长 chunk 合计可能接近限制。
 * - 分批减少单次失败的影响范围，且更容易在出错时定位是哪批有问题。
 *
 * 100 这个值：每个 chunk 最多 800 字符，中文约 400 token；
 * 100 条合计约 40000 token，远超单次限制；
 * 但实际文档一般远小于这个量，保守取 100 作为安全边界。
 * 对于本 MVP（5MB 上限、中文为主），实际切出的 chunk 数通常在 10~50 之间，
 * 所以大多数上传只会触发一次 API 请求。
 */
const BATCH_SIZE = 100

/**
 * text-embedding-3-small 的默认输出维度。
 * 不在 API 调用中显式指定 dimensions，使用模型默认值；
 * 在这里做显式声明是为了让下面的验证逻辑有一个可读的常量，
 * 而不是直接写魔法数字 1536。
 */
const EXPECTED_DIM = 1536

// ─── OpenAI 客户端（延迟初始化） ───────────────────────────────────────────────

/**
 * 为什么不在模块加载时直接 new OpenAI()：
 * - 模块加载时 dotenv 不一定已执行完，process.env.OPENAI_API_KEY 可能还是 undefined。
 * - 延迟初始化让 client 只在首次调用 embedChunks 时创建，
 *   此时 dotenv 已经在入口文件最顶部执行，环境变量一定已读入。
 * - 另一个好处：若后端只跑测试而不调用 embedChunks，不会触发"无密钥"报错。
 *
 * 替代方案：在 index.ts 启动时统一检查必要环境变量（"fail fast"模式）；
 * 本 MVP 优先简单，不做统一前置检查，改为在首次调用时检查。
 */
let _client: OpenAI | null = null

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error(
        '[embedder] OPENAI_API_KEY 未配置，请在根目录 .env 文件中设置。',
      )
    }
    _client = new OpenAI({ apiKey })
  }
  return _client
}

// ─── 核心函数 ─────────────────────────────────────────────────────────────────

/**
 * 对文本数组批量生成 embedding 向量。
 *
 * @param texts  已切好的 chunk 文本列表（来自 chunkText）
 * @returns      与 texts 顺序一一对应的 embedding 数组（每条 1536 维）
 * @throws       API 失败、返回数量不符或维度不符时抛出错误
 */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const client = getClient()
  const allEmbeddings: number[][] = []

  // 按批次串行请求
  // 为什么串行而非并行（Promise.all）：
  // - 并行可以加速，但 OpenAI 有 RPM（每分钟请求数）和 TPM（每分钟 token 数）限制；
  //   MVP 文档通常只有几十个 chunk，串行不会有感知延迟，且不会触发 429 限流。
  // - 串行更容易在第 n 批失败时快速判断原因，不会与其他并发批次产生干扰。
  for (let batchStart = 0; batchStart < texts.length; batchStart += BATCH_SIZE) {
    const batch = texts.slice(batchStart, batchStart + BATCH_SIZE)

    let response: Awaited<ReturnType<typeof client.embeddings.create>>

    try {
      response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: batch,
        // 不设置 encoding_format（默认 float），返回 number[] 类型
      })
    } catch (err) {
      // 把 OpenAI SDK 抛出的错误（如网络失败、401、429）包装后重新抛出，
      // 并附上批次范围信息，方便路由层记录日志；
      // 原始 err 保留在 cause 中，不暴露给前端
      throw new Error(
        `[embedder] OpenAI API 请求失败（批次 ${batchStart}~${batchStart + batch.length - 1}）`+
        { cause: err },
      )
    }

    const returned = response.data

    // 完整性校验 1：返回数量必须与输入数量一致
    // 正常情况下 OpenAI 不会少返回，但做防御性校验，
    // 避免因截断或排序错误导致 embedding 与 chunk 错位
    if (returned.length !== batch.length) {
      throw new Error(
        `[embedder] OpenAI 返回向量数量（${returned.length}）与输入数量（${batch.length}）不一致`,
      )
    }

    // 完整性校验 2：每条向量维度必须是 1536
    // OpenAI 可能因模型升级、参数变化而改变默认维度；
    // 若不校验，后续 cosine similarity 计算会静默得出错误结果
    for (let i = 0; i < returned.length; i++) {
      const embedding = returned[i].embedding
      if (embedding.length !== EXPECTED_DIM) {
        throw new Error(
          `[embedder] 第 ${batchStart + i} 条 embedding 维度为 ${embedding.length}，预期 ${EXPECTED_DIM}`,
        )
      }
      // OpenAI SDK 的 response.data 按 index 字段排序，
      // 但为了绝对安全，使用 returned[i].index 而非假设顺序
      allEmbeddings[returned[i].index + batchStart] = embedding
    }
  }

  return allEmbeddings
}
