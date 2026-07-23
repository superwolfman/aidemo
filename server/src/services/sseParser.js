export function parseSseData(data) {
  const text = String(data || '').trim();
  if (!text) return '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function parseSseEvents(payload) {
  const events = [];
  let current = { event: 'message', data: [], id: undefined };

  function flush() {
    if (!current.data.length && !current.id) return;
    events.push({
      event: current.event || 'message',
      id: current.id,
      data: parseSseData(current.data.join('\n'))
    });
    current = { event: 'message', data: [], id: undefined };
  }

  for (const rawLine of String(payload || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith(':')) continue;
    const index = line.indexOf(':');
    const field = index === -1 ? line : line.slice(0, index);
    const value = index === -1 ? '' : line.slice(index + 1).replace(/^ /, '');
    if (field === 'event') current.event = value || 'message';
    if (field === 'id') current.id = value;
    if (field === 'data') current.data.push(value);
  }
  flush();
  return events;
}
