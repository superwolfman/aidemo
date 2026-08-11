import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSseEvents } from '../src/services/sseParser.js';
import { closeSse } from '../src/utils/sse.js';

test('sse parser parses named json events', () => {
  const events = parseSseEvents('event: trace\ndata: {"id":"step-1","status":"success"}\n\n');

  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'trace');
  assert.deepEqual(events[0].data, { id: 'step-1', status: 'success' });
});

test('sse parser supports multiline text payload', () => {
  const events = parseSseEvents('event: token\ndata: hello\ndata: world\n\n');

  assert.equal(events[0].event, 'token');
  assert.equal(events[0].data, 'hello\nworld');
});

test('SSE close event preserves failed completion semantics', () => {
  const chunks = [];
  let ended = false;
  const response = {
    write (chunk) { chunks.push(chunk); },
    end () { ended = true; }
  };

  closeSse(response, { ok: false, code: 'KNOWLEDGE_SCOPE_FORBIDDEN' });

  const events = parseSseEvents(chunks.join(''));
  assert.equal(ended, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'done');
  assert.deepEqual(events[0].data, {
    ok: false,
    code: 'KNOWLEDGE_SCOPE_FORBIDDEN'
  });
});
