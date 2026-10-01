export const runtime = 'nodejs';

export async function GET() {
  return Response.json({
    openai: Boolean(process.env.OPENAI_API_KEY),
    github: Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_ALLOWED_REPOS),
    model: process.env.OPENAI_MODEL || 'gpt-5.6-sol',
  });
}
