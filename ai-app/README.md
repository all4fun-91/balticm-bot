# BalticM AI

A first production-shaped MVP for a private ChatGPT-style engineering assistant.

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fall4fun-91%2Fbalticm-bot%2Ftree%2Ffeature%2Fbalticm-ai-mvp&root-directory=ai-app&project-name=balticm-ai&env=OPENAI_API_KEY&env=GITHUB_TOKEN&env=GITHUB_ALLOWED_REPOS&envDescription=OPENAI_API_KEY+is+required.+GITHUB_TOKEN+and+GITHUB_ALLOWED_REPOS+enable+Agent+mode.&envLink=https%3A%2F%2Fplatform.openai.com%2Fapi-keys)

The deploy flow is preconfigured with:

- Root Directory: `ai-app`
- Project name: `balticm-ai`
- Required secret: `OPENAI_API_KEY`
- Optional Agent secrets: `GITHUB_TOKEN`, `GITHUB_ALLOWED_REPOS`

Use the **BalticM** Vercel team. For `GITHUB_ALLOWED_REPOS`, start with:

```
all4fun-91/balticm-bot
```

## What is included

- Streaming chat through the OpenAI Responses API.
- Agent mode with OpenAI web search.
- GitHub read tools: list allow-listed repositories, read files/directories, search code.
- GitHub write tools: create branch and create/update files.
- Writes are blocked unless the user enables **Allow GitHub writes** for that specific agent run.
- GitHub repository allow-listing with `GITHUB_ALLOWED_REPOS`.
- Project memory stored locally in the browser and sent as context with each request.
- Local browser chat history.
- Connection status for OpenAI and GitHub.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Set `OPENAI_API_KEY`.
3. Optional for Agent GitHub tools: set a fine-grained `GITHUB_TOKEN` and `GITHUB_ALLOWED_REPOS`.
4. Prefer a fine-grained GitHub token scoped only to the repositories BalticM AI may access. Give read-only permissions first; add repository Contents write permission only when you are ready to test write mode.
5. Run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Verification

GitHub Actions runs `npm install`, server-side syntax checks, and `npm run build` for this branch and pull request.

## Security design

The browser never receives the OpenAI or GitHub tokens. GitHub operations run server-side. Repositories must be present in `GITHUB_ALLOWED_REPOS`. Write tools are additionally gated per request by the UI's **Allow GitHub writes** switch.

This MVP intentionally does **not** deploy or restart production services. Deployment tools should be added later as separate, explicitly approved actions.

## Next milestones

1. Persist accounts, chats and project memory in Postgres instead of localStorage.
2. Add GitHub OAuth/App installation instead of one server token.
3. Add patch/diff review and explicit per-change approval before commits.
4. Add Vercel / Cloudflare / SSH tools with separate permissions.
5. Add file upload, image understanding and searchable project knowledge.
6. Add resumable long-running agent tasks and execution logs.
