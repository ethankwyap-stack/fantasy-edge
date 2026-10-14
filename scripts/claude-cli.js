// Drop-in for the SDK's client.messages.create() that runs `claude -p` instead, so Claude
// is billed to the Claude plan (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`) rather
// than per token through ANTHROPIC_API_KEY. Returns the same { content, stop_reason } shape
// the callers already read. max_tokens/thinking are ignored: the CLI thinks adaptively
// with a 64k output cap.
const { spawnSync } = require('child_process');

// True when a real Claude call should happen: the Actions secret, or CLAUDE_LIVE=1 locally
// (uses your own `claude` login). Otherwise the scripts dry-run as before.
const live = () => !!(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.CLAUDE_LIVE);

function create({ model, system, messages, output_config }, spawn = spawnSync) {
  const args = ['-p', '--model', model, '--system-prompt', system, '--tools', '',
    '--output-format', 'json', '--no-session-persistence', '--setting-sources', ''];
  const schema = output_config?.format?.type === 'json_schema' && output_config.format.schema;
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  if (output_config?.effort) args.push('--effort', output_config.effort);
  const r = spawn('claude', args, { input: messages.map(m => m.content).join('\n\n'), encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
  let out;
  try { out = JSON.parse(r.stdout); } catch { throw new Error(`claude -p exit ${r.status}: ${(r.stderr || r.stdout || r.error?.message || '').slice(0, 500)}`); }
  if (r.status || out.is_error) throw new Error(`claude -p failed: ${String(out.result).slice(0, 500)}`);
  const text = schema ? JSON.stringify(out.structured_output ?? JSON.parse(out.result)) : (out.result || '');
  return { content: [{ type: 'text', text }], stop_reason: out.stop_reason, usage: { input_tokens: out.usage?.input_tokens, output_tokens: out.usage?.output_tokens } };
}

module.exports = { create, live, client: { messages: { create: kw => create(kw) } } };
