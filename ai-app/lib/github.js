const API = 'https://api.github.com';

function token() {
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not configured.');
  return process.env.GITHUB_TOKEN;
}

function allowedRepos() {
  return new Set(
    (process.env.GITHUB_ALLOWED_REPOS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function assertAllowed(repo) {
  if (!repo || !allowedRepos().has(repo)) {
    throw new Error(`Repository is not allow-listed: ${repo || '(missing)'}`);
  }
}

async function github(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${data?.message || text}`);
  }
  return data;
}

export async function listRepositories() {
  const allow = allowedRepos();
  if (!allow.size) return [];

  const repos = [];
  for (const fullName of allow) {
    const data = await github(`/repos/${fullName}`);
    repos.push({
      full_name: data.full_name,
      default_branch: data.default_branch,
      private: data.private,
      updated_at: data.updated_at,
    });
  }
  return repos;
}

export async function readFile({ repo, path, ref = 'main' }) {
  assertAllowed(repo);
  const data = await github(`/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
  if (Array.isArray(data)) {
    return data.map((item) => ({ name: item.name, path: item.path, type: item.type, sha: item.sha }));
  }
  if (data.type !== 'file') throw new Error('Requested path is not a file.');

  return {
    path: data.path,
    sha: data.sha,
    content: Buffer.from(data.content || '', 'base64').toString('utf8'),
  };
}

export async function searchCode({ repo, query }) {
  assertAllowed(repo);
  const q = encodeURIComponent(`${query} repo:${repo}`);
  const data = await github(`/search/code?q=${q}&per_page=10`);
  return (data.items || []).map((item) => ({
    name: item.name,
    path: item.path,
    sha: item.sha,
    url: item.html_url,
  }));
}

export async function createBranch({ repo, branch, base = 'main' }) {
  assertAllowed(repo);
  const baseRef = await github(`/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  const sha = baseRef?.object?.sha;
  if (!sha) throw new Error(`Could not resolve base branch ${base}.`);

  const created = await github(`/repos/${repo}/git/refs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });

  return { branch, sha: created?.object?.sha || sha };
}

export async function upsertFile({ repo, path, content, message, branch = 'main' }) {
  assertAllowed(repo);
  let sha;
  try {
    const existing = await github(`/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`);
    sha = existing?.sha;
  } catch (error) {
    if (!String(error.message).includes('GitHub API 404')) throw error;
  }

  const payload = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  };

  const result = await github(`/repos/${repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return {
    path,
    branch,
    commit_sha: result?.commit?.sha,
    file_sha: result?.content?.sha,
  };
}

function encodePath(path) {
  return String(path)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}
