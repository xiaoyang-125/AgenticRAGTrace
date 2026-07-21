# CLAUDE.md - Agentic RAG Trace 项目 AI 上下文

每次开始新对话时，请先完整读完这个文件，再开始任何工作。

这份文档用于给 AI 提供长期稳定的项目上下文，目标是帮助 AI 在协作开发时不跑偏、不扩张范围、不提前实现无关功能。

## 1. 项目目标

这是一个一周 MVP 的 Agentic RAG Demo。

目标不是做大而全的个人知识库平台，而是做一个小而完整、可运行、可演示、可讲解的 AI 应用闭环。

项目重点是：

- RAG 的语义检索闭环
- 固定 Agent Workflow
- 答案引用来源（sources）
- Trace Timeline 可视化
- 资料不足时的有限回答

## 2. 当前 MVP 范围

当前版本只保留以下核心能力：

- 文档上传
- Markdown / TXT 解析
- chunk 切分
- embedding 生成
- 向量相似度检索 topK
- 固定 Agent Workflow：Parse / Retrieve / Judge / Generate / Validate
- answer + sources 返回
- 前端 Trace Timeline 展示
- 资料不足时的有限回答

## 3. 开发原则

- 一次只实现当天任务，不提前实现后续功能
- 代码优先简单、直接、可运行，不做过度抽象
- 当前目标是稳定完成 demo，而不是搭建完整平台
- 如果存在多种实现方案，优先选择最省时间、最稳、最容易联调的方案
- 不要为了“未来扩展”提前引入当前用不上的复杂结构
- 所有新增代码都应服务于当前 MVP 主链路：

上传资料 → 解析与入库 → 检索 → 回答 → 展示 Trace

## 4. 技术栈

- 前端：React + TypeScript + Vite + Tailwind CSS
- 后端：Express + TypeScript
- 存储：本地 JSON
- 检索：embedding + cosine similarity + topK retrieval

## 5. 代码协作要求

当我提出当天任务时，请严格只完成当天范围。

请优先输出：

1. 新增/修改文件列表
2. 每个文件职责
3. 关键数据结构
4. 代码实现
5. 本地验证方式

除非我明确要求，否则不要：

- 提前实现下一天功能
- 增加多 provider 切换
- 增加历史记录模块
- 增加 SSE / 流式输出
- 增加复杂 Validate 体系
- 增加与当前主链路无关的 UI 或工程抽象

## 6. 当前项目判断标准

这个项目成功的标准不是功能很多，而是：

- 能上传文档
- 能完成 chunk 与 embedding 入库
- 能对问题做语义检索并召回 topK chunks
- 能返回 answer + sources
- 能展示固定 Step Trace
- 能在资料不足时给出有限回答

一句话总结：

这是一个聚焦 Agent + RAG + Trace 核心体验的小型 Demo，不是完整知识库平台。
