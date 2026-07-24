# AgenticRAGTrace
这是一个单人使用的个人知识库问答 Demo，核心目标是展示 Agentic RAG Workflow。 用户上传 Markdown / TXT 文档，系统对文档做文本解析和 chunk 切分，并通过固定六步 Agent Workflow 完成问题解析、检索规划、知识检索、上下文充分性判断、答案生成、输出校验，最终返回带引用来源的答案。前端展示每一步的完整执行 Trace。

## 快速启动

### 1. 配置环境变量

```bash
# 在项目根目录复制示例文件
cp .env.example .env
```

打开 `.env`，将 `OPENAI_API_KEY=sk-xxx` 替换为你真实的 OpenAI API Key。

> Key 获取地址：https://platform.openai.com/api-keys  
> `.env` 已被 `.gitignore` 忽略，不会提交到版本库。

### 2. 安装依赖

```bash
pnpm install
```

### 3. 启动后端

```bash
pnpm --filter backend dev
```

### 4. 启动前端

```bash
pnpm --filter frontend dev
```

