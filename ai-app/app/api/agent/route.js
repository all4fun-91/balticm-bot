import { createResponse, getOpenAIConfig, getResponseText } from '@/lib/openai';
import { buildInstructions } from '@/lib/prompts';
import { createBranch, listRepositories, readFile, searchCode, upsertFile } from '@/lib/github';

export const runtime = 'nodejs';
export const maxDuration = 180;

const tools = [
  {
    type: 'web_search',
  },
  {
    type: 'function',
    name: 'github_list_repositories',
    description: 'List GitHub repositories that this AI is explicitly allowed to access.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: 'function',
    name: 'github_read_file',
    description: 'Read a UTF-8 text file or list a directory from an allow-listed GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        path: { type: 'string' },
        ref: { type: 'string' },
      },
      required: ['repo', 'path', 'ref'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'github_search_code',
    description: 'Search code in one allow-listed GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        query: { type: 'string' },
      },
      required: ['repo', 'query'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'github_create_branch',
    description: 'Create a GitHub branch. Use only when writes are enabled for this run.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        branch: { type: 'string' },
        base: { type: 'string' },
      },
      required: ['repo', 'branch', 'base'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'github_upsert_file',
    description: 'Create or replace a UTF-8 text file on a GitHub branch. Use only when writes are enabled for this run.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        path: { type: 'string' },
        content: { type: 'string' },
        message: { type: 'string' },
        branch: { type: 'string' },
      },
      required: ['repo', 'path', 'content', 'message', 'branch'],
      additionalProperties: false,
    },
    strict: true,
  },
];

export async function POST(request) {
  try {
    const body = await request.json();
    const allowWrites = body.allowWrites === true;
    const { model: defaultModel } = getOpenAIConfig();
    const model = body.model || defaultModel;
    const messages = normalizeMessages(body.messages);
    const trace = [];

    let response = await callAgent({
      model,
      instructions: buildInstructions({ projectMemory: body.projectMemory, agent: true, allowWrites }),
      input: messages,
    });

    for (let step = 0; step < 8; step += 1) {
      const calls = (response.output || []).filter((item) => item.type === 'function_call');
      if (!calls.length) {
        return Response.json({
          text: getResponseText(response) || 'Agent finished without a text response.',
          trace,
          responseId: response.id,
        });
      }

      const outputs = [];
      for (const call of calls) {
        const args = safeJson(call.arguments);
        const result = await executeTool(call.name, args, allowWrites);
        trace.push({ tool: call.name, args: redactArgs(call.name, args), ok: result.ok, summary: result.summary });
        outputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }

      response = await callAgent({
        model,
        previous_response_id: response.id,
        input: outputs,
      });
    }

    return Response.json({ error: 'Agent reached the maximum tool-step limit.', trace }, { status: 508 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

async function callAgent({ model, instructions, input, previous_response_id }) {
  const payload = {
    model,
    tools,
    input,
    ...(instructions ? { instructions } : {}),
    ...(previous_response_id ? { previous_response_id } : {}),
  };
  const response = await createResponse(payload);
  return response.json();
}

async function executeTool(name, args, allowWrites) {
  try {
    let data;
    switch (name) {
      case 'github_list_repositories':
        data = await listRepositories();
        break;
      case 'github_read_file':
        data = await readFile(args);
        break;
      case 'github_search_code':
        data = await searchCode(args);
        break;
      case 'github_create_branch':
        if (!allowWrites) return blocked(name);
        data = await createBranch(args);
        break;
      case 'github_upsert_file':
        if (!allowWrites) return blocked(name);
        data = await upsertFile(args);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return { ok: true, summary: summarize(name, data), data };
  } catch (error) {
    return { ok: false, summary: error.message, error: error.message };
  }
}

function blocked(name) {
  return {
    ok: false,
    requires_confirmation: true,
    summary: `${name} was blocked because GitHub writes are disabled for this run.`,
  };
}

function summarize(name, data) {
  if (name === 'github_list_repositories') return `Found ${data.length} allow-listed repositories.`;
  if (name === 'github_search_code') return `Found ${data.length} matching files.`;
  if (name === 'github_read_file') return `Read ${data.path || 'directory'}.`;
  if (name === 'github_create_branch') return `Created branch ${data.branch}.`;
  if (name === 'github_upsert_file') return `Updated ${data.path} on ${data.branch}.`;
  return 'Tool completed.';
}

function safeJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function redactArgs(name, args) {
  if (name !== 'github_upsert_file') return args;
  return { ...args, content: `[${String(args.content || '').length} characters]` };
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => ['user', 'assistant'].includes(message?.role) && typeof message?.content === 'string')
    .slice(-40)
    .map(({ role, content }) => ({ role, content }));
}
