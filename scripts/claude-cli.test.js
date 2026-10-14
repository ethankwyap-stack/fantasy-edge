// node --test scripts/ — free, no network: checks the `claude -p` argv and reply mapping.
const test = require('node:test');
const assert = require('node:assert');
const { create } = require('./claude-cli');

const fakeSpawn = (stdout, status = 0) => {
  const seen = {};
  const fn = (cmd, args, opts) => { Object.assign(seen, { cmd, args, input: opts.input }); return { status, stdout, stderr: '' }; };
  return { fn, seen };
};

test('plain text call: builds the argv and maps the reply to the SDK shape', () => {
  const { fn, seen } = fakeSpawn(JSON.stringify({ result: 'NO_ALERT', stop_reason: 'end_turn', is_error: false }));
  const res = create({ model: 'claude-sonnet-5', max_tokens: 1024, system: 'SYS', messages: [{ role: 'user', content: 'PROMPT' }] }, fn);
  assert.strictEqual(seen.cmd, 'claude');
  assert.deepStrictEqual(seen.args.slice(0, 1), ['-p']);
  assert.strictEqual(seen.args[seen.args.indexOf('--model') + 1], 'claude-sonnet-5');
  assert.strictEqual(seen.args[seen.args.indexOf('--system-prompt') + 1], 'SYS');
  assert.strictEqual(seen.args[seen.args.indexOf('--tools') + 1], '');
  assert.ok(!seen.args.includes('--json-schema'));
  assert.strictEqual(seen.input, 'PROMPT');
  assert.strictEqual(res.content.filter(b => b.type === 'text').map(b => b.text).join(''), 'NO_ALERT');
  assert.strictEqual(res.stop_reason, 'end_turn');
});

test('json_schema call: passes --json-schema and returns structured_output as the text', () => {
  const schema = { type: 'object', properties: { players: { type: 'array' } } };
  const { fn, seen } = fakeSpawn(JSON.stringify({ result: 'x', structured_output: { players: [1] }, stop_reason: 'tool_use', is_error: false }));
  const res = create({ model: 'm', system: 's', output_config: { format: { type: 'json_schema', schema } }, messages: [{ role: 'user', content: 'u' }] }, fn);
  assert.deepStrictEqual(JSON.parse(seen.args[seen.args.indexOf('--json-schema') + 1]), schema);
  assert.deepStrictEqual(JSON.parse(res.content[0].text), { players: [1] });
});

test('CLI error throws instead of reading as an empty reply', () => {
  const { fn } = fakeSpawn(JSON.stringify({ result: 'Invalid API key', is_error: true }), 1);
  assert.throws(() => create({ model: 'm', system: 's', messages: [{ role: 'user', content: 'u' }] }, fn), /claude -p failed/);
});
