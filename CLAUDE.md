# CLAUDE.md - Agentic RAG Trace 项目 AI 上下文
每次开始新对话时，请先完整读完这个文件，再开始任何工作。
每天结束后，在「模块进度」里更新完成状态，并把实际生成的类型变更同步到「核心数据结构」。
## 一、项目一句话定位
这是一个单人使用的个人知识库问答 Demo，核心目标是展示 Agentic RAG Workflow。
用户上传 Markdown / TXT 文档，系统对文档做文本解析和 chunk 切分，并通过固定六步 Agent Workflow 完成问题解析、检索规划、知识检索、上下文充分性判断、答案生成、输出校验，最终返回带引用来源的答案。前端展示每一步的完整执行 Trace。
项目不是：生产级知识库平台、多用户协作系统、模型微调项目。
## 二、技术栈
### 前端
React 18 + TypeScript
Vite（开发服务器默认 localhost:5173）
Tailwind CSS
React Context + useReducer 管理全局状态
Fetch API 请求后端
### 后端
Node.js + Express + TypeScript
开发服务器默认 localhost:3000
Multer：文件上传
natural：TF-IDF / 分词
Zod：运行时结构校验
dotenv：环境变量
CORS：跨域
### 存储
本地 JSON 文件，无数据库
通过 Repository 层封装，不在业务代码里直接读写文件
## 三、目录结构
```Plain/Text
project-root/
├── CLAUDE.md              ← 本文件，AI 上下文
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── DocumentPanel/     ← 左侧：文档列表、上传、删除
│   │   │   ├── ChatPanel/         ← 中间：问答输入、答案、sources
│   │   │   └── TracePanel/        ← 右侧：Agent Step Timeline
│   │   ├── context/               ← React Context + useReducer
│   │   ├── types/                 ← 前端类型定义（与后端 types 保持一致）
│   │   └── App.tsx
│   └── ...
├── backend/
│   ├── src/
│   │   ├── types/                 ← 核心类型定义（Document / Chunk / AgentRun 等）
│   │   ├── repository/            ← JSON 读写层
│   │   │   ├── DocumentRepository.ts
│   │   │   ├── ChunkRepository.ts
│   │   │   └── RunRepository.ts
│   │   ├── lib/
│   │   │   ├── parser.ts          ← Markdown / TXT 解析为纯文本
│   │   │   ├── chunker.ts         ← 文本切分为 Chunk[]
│   │   │   └── retriever/
│   │   │       ├── index.ts       ← Retriever 抽象接口
│   │   │       ├── KeywordRetriever.ts  ← MVP baseline，首周优先实现
│   │   │       └── TfidfRetriever.ts    ← 可选升级，第二周后半或第三周再做
│   │   ├── agent/
│   │   │   ├── runtime.ts         ← AgentRuntime 类，顺序执行 steps
│   │   │   ├── agent-context.ts   ← AgentContext，steps 间状态传递
│   │   │   └── steps/
│   │   │       ├── ParseQuestionStep.ts
│   │   │       ├── PlanRetrievalStep.ts
│   │   │       ├── RetrieveKnowledgeStep.ts
│   │   │       ├── JudgeContextStep.ts
│   │   │       ├── GenerateAnswerStep.ts
│   │   │       └── ValidateOutputStep.ts
│   │   ├── provider/
│   │   │   ├── index.ts           ← LLMProvider 接口
│   │   │   ├── MockProvider.ts
│   │   │   └── KimiProvider.ts
│   │   ├── routes/
│   │   │   ├── documents.ts       ← POST/GET/DELETE /api/documents
│   │   │   └── runs.ts            ← POST/GET /api/runs
│   │   └── app.ts                 ← Express 入口
│   └── ...
└── data/                          ← 本地存储，不进 git
    ├── documents.json
    ├── chunks.json
    └── runs.json
```
补充约束：目录结构是推荐落地形态，不要求第一天把所有文件一次性建完。MVP 阶段优先创建最小闭环所需文件，尤其是 KeywordRetriever.ts 必做，TfidfRetriever.ts 可以先不创建。
## 四、核心数据结构
这是当前版本的权威类型基线。新建或修改代码时必须优先与这里保持一致；如果实现中确实需要新增字段或调整结构，先更新本节，再改代码，避免代码与文档漂移。
```TypeScript
type ProviderType = 'mock' | 'kimi';
type RetrieverType = 'keyword' | 'tfidf' | 'embedding';
type AgentStepName =
  | 'Parse Question'
  | 'Plan Retrieval'
  | 'Retrieve Knowledge'
  | 'Judge Context'
  | 'Generate Answer'
  | 'Validate Output';
type AgentStepStatus = 'waiting' | 'running' | 'success' | 'failed';
type QuestionType =
  | 'concept_explanation'
  | 'project_summary'
  | 'interview_answer'
  | 'comparison'
  | 'unknown';
type WarningCode =
  | 'no_sources'
  | 'context_not_enough'
  | 'json_repaired'
  | 'source_removed'
  | 'fallback_used';

// ─── 文档 ───────────────────────────────────────────────────
interface Document {
  id: string;             // "doc_" + nanoid
  title: string;          // MVP 固定为文件名去掉后缀，不从 Markdown H1 提取
  fileName: string;       // 原始文件名
  fileSize: number;       // 字节数
  chunkCount: number;
  createdAt: string;      // ISO 8601
}

// ─── Chunk ──────────────────────────────────────────────────
interface Chunk {
  chunkId: string;        // "{documentId}_chunk_{index}"
  documentId: string;
  documentTitle: string;
  content: string;
  chunkIndex: number;
  embedding?: number[];   // 可选，轻量 embedding 方案时使用
  createdAt: string;
}

// ─── 检索结果（带分数）──────────────────────────────────────
interface RetrievedChunk extends Chunk {
  score: number;
}

// ─── 引用来源 ────────────────────────────────────────────────
// source.chunkId 必须来自当次 Retrieve Step 返回的 chunks，不允许模型自造
interface Source {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
}

// ─── Tool Call ──────────────────────────────────────────────
interface ToolCall {
  name: string;
  input: unknown;
  output?: unknown;
  error?: string;
  duration: number;       // ms
}

// ─── Agent Step ─────────────────────────────────────────────
interface AgentStep {
  name: AgentStepName;
  status: AgentStepStatus;
  input?: unknown;
  output?: unknown;
  toolCalls: ToolCall[];
  warnings: WarningCode[];
  error?: string;
  startedAt?: string;
  endedAt?: string;
  duration?: number;      // ms
}

// ─── Agent Run ──────────────────────────────────────────────
interface AgentRun {
  id: string;             // "run_" + nanoid
  question: string;
  provider: ProviderType;
  retriever: RetrieverType;
  topK: number;           // 默认 5
  status: 'running' | 'success' | 'failed';
  steps: AgentStep[];
  answer?: string;
  sources?: Source[];
  warnings: WarningCode[];
  duration: number;       // ms
  createdAt: string;
}

// ─── Agent Context（steps 间传递状态）───────────────────────
interface AgentContext {
  runId: string;
  question: string;
  provider: ProviderType;
  retriever: RetrieverType;
  topK: number;
  // 由各 step 写入
  parsedQuestion?: {
    originalQuestion: string;
    normalizedQuestion: string;
    keywords: string[];
    normalizedKeywords: string[];
    questionType: QuestionType;
  };
  retrievalPlan?: {
    query: string;
    keywords: string[];
    topK: number;
    questionType: QuestionType;
    needExamples: boolean;
  };
  retrievedChunks?: RetrievedChunk[];
  contextJudge?: {
    isEnough: boolean;
    reason: string;
    missingInfo: string[];
  };
  generatedAnswer?: {
    answer: string;
    sources: Source[];
    missingInfo?: string[];
  };
}
```
补充约束：
RetrieverType 中，MVP 默认使用 keyword；tfidf 是明确升级项；embedding 只保留类型口子，两周内不要求实现。
warning 统一使用 WarningCode，不要在代码里随意创造新的字符串。
## 五、Agent Workflow（六步固定流程）
```Plain/Text
Step 1: Parse Question
  输入：question (string)
  输出：parsedQuestion → 写入 AgentContext
  工具调用：无
  规则：
    问题为空则 fatal error
    必须保留 originalQuestion，并生成 normalizedQuestion / keywords / normalizedKeywords / questionType

Step 2: Plan Retrieval
  输入：parsedQuestion
  输出：retrievalPlan → 写入 AgentContext
  工具调用：无
  规则：
    MVP 用规则生成，不调 LLM
    基于 questionType 生成 retrieval query
    retrievalPlan.questionType 与 parsedQuestion.questionType 保持一致，不额外发明一套 intent 枚举

Step 3: Retrieve Knowledge
  输入：retrievalPlan
  输出：retrievedChunks → 写入 AgentContext
  工具调用：knowledge_retrieval
  规则：
    chunks 为空不报错，继续执行
    返回结果按 score 降序
    source 只允许引用当次 retrievedChunks

Step 4: Judge Context
  输入：question + retrievedChunks
  输出：contextJudge → 写入 AgentContext
  工具调用：无
  规则：
    MVP 用规则判断，score 过低或 chunks 为空则 isEnough=false
    isEnough=false 时必须给出 reason 和 missingInfo

Step 5: Generate Answer
  输入：question + retrievedChunks + contextJudge
  输出：generatedAnswer → 写入 AgentContext
  工具调用：llm_generate
  规则：
    chunks 为空 → 不调 LLM，直接返回无相关资料提示
    isEnough=false → 可以调 LLM，但只允许生成有限回答 + 缺失信息提示
    isEnough=false 时不允许补全知识库之外的完整结论，不允许把猜测写成确定事实
    isEnough=true → 调 LLM 正常生成
    LLM 返回非 JSON 时，不直接 fatal，按 parse → 提取 JSON 代码块 → repair / fallback 顺序兜底

Step 6: Validate Output
  输入：generatedAnswer + retrievedChunks + contextJudge
  输出：valid, warnings, errors
  工具调用：无（Zod + 规则校验）
  规则：
    结构校验（Zod）
    source.chunkId 必须来自 retrievedChunks
    isEnough=false 时 answer 必须显式说明资料不足，且应能对应 missingInfo
    非法 source 丢弃，记 `source_removed` warning，不 fatal
    fallback 生效时记录 `fallback_used`；JSON repair 成功时记录 `json_repaired`
```
补充说明：这个项目是 fixed workflow agent / agentic workflow，不是自由规划型 Agent。不要为了“更像 Agent”而额外引入 planner、router、多 Agent 或自动网页搜索。
## 六、API 接口
```Plain/Text
GET  /api/health                   ← 健康检查
POST /api/documents                ← 上传文档（multipart/form-data）
GET  /api/documents                ← 文档列表
DELETE /api/documents/:id          ← 删除文档（含 chunks）
POST /api/runs                     ← 创建 Agent Run
GET  /api/runs                     ← 历史 run 列表（最近 3 条）
GET  /api/runs/:id                 ← 单个 run 详情
```
## 七、关键约束
Repository 层：不在 routes / service / agent 里直接 fs.readFileSync，必须通过 Repository。
source 校验：source.chunkId 必须来自当次 Retrieve Step 的 retrievedChunks，Validate Step 强制校验。
LLM JSON 不稳定：Generate Answer Step 必须有 fallback，非 JSON 不直接 fatal，先 parse → 提取 JSON 代码块 → repair → fallback 为纯文本 answer。
错误分级：
fatal error → run failed（问题为空、文件读取失败、API Key 缺失）
recoverable warning → run success + warnings（source 非法、JSON fallback、资料不足）
warning 取值：统一使用 no_sources / context_not_enough / json_repaired / source_removed / fallback_used，不要自行发明新 warning 字符串。
历史记录：runs.json 最多保留 3 条，超过自动删除最旧的。
单用户：没有用户系统，所有数据共享，这是主动取舍。
不做文档预览：左侧只展示文件列表，不做文档内容预览和 chunk 管理 UI。
Document.title 规则：MVP 中 title 固定取文件名去后缀，不从 Markdown H1 自动提取。
Retriever 策略：MVP 默认先做 keyword，tfidf 是升级项，embedding 只保留接口和类型口子。
实现节奏：先做最小闭环，再补 Trace，再补 Validate 和 fallback，不要一开始同时搭完整检索升级、复杂 UI 和真实模型。
## 八、模块进度
每天结束后在这里更新，下次对话 AI 读到最新状态。
Day 1：项目初始化（前后端能跑，health 接口通）
Day 2：Repository 层（DocumentRepository / ChunkRepository / RunRepository）
Day 3：上传接口（POST /api/documents，含类型/大小/重名校验）
Day 4：解析 + chunk（parser.ts + chunker.ts）
Day 5：文档列表 / 删除（GET / DELETE /api/documents）
Day 6：Retriever baseline（KeywordRetriever，返回 topK RetrievedChunk）
Day 7：Agent Runtime 骨架（runtime.ts + context.ts + types）
Day 8：6 个 Step + mock provider（全链路 mock 跑通）
Day 9：Validate + source 校验（chunkId 合法性 + warnings）
Day 10：前端文档区（上传 / 列表 / 删除 UI）
Day 11：前端问答区（提问 / answer / sources UI）
Day 12：Agent Trace Timeline（右侧栏 6 Step 展示，可展开）
Day 13：历史记录 + 错误态（最近 3 条，空库 / 检索为空有提示）
Day 14：打磨 + README（修 bug，固定演示问题，README 初版）
## 九、每日对话开场模板
```Plain/Text
请先读完 CLAUDE.md（已附在上方），了解项目背景和当前进度。

今天只做：[模块名称]

要求：
- 先输出方案（文件路径 + 接口设计），不要写代码
- 我说「可以」后再开始
- 每次只输出一个文件，等我说「继续」再输出下一个
- 不要修改 CLAUDE.md 以外的已有文件，只新建：[文件列表]
```
## 十、明确不做项（面试被问到时直接说是主动取舍）
文档内容预览 / Markdown 阅读器
内置 examples 示例文档目录
多用户 / 登录 / 权限
PDF / Word / Excel 解析
多 Agent 协作
模型微调
embedding 检索（两周内不碰，第三周视时间决定）
SSE / WebSocket / LLM 流式输出（可选增强，不进 MVP）
生产级数据库

