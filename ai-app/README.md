# BalticM AI

A first production-shaped MVP for a private ChatGPT-style engineering assistant.

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
