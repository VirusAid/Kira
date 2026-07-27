// Минимальный MCP-сервер для проверки клиента Киры.
let buf = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', (c) => {
  buf += c
  let nl
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
    if (!line) continue
    const m = JSON.parse(line)
    if (m.method === 'initialize') {
      send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'fake', version: '1' } } })
    } else if (m.method === 'tools/list') {
      // отдаём двумя страницами — проверяем пагинацию
      if (!m.params || !m.params.cursor) {
        send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', title: 'Эхо', description: 'повторяет', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }], nextCursor: 'p2' } })
      } else {
        send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'boom', description: 'всегда падает', inputSchema: { type: 'object' } }] } })
      }
    } else if (m.method === 'tools/call') {
      if (m.params.name === 'echo') {
        send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'эхо: ' + m.params.arguments.text }] } })
      } else if (m.params.name === 'boom') {
        send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'внутренняя поломка' }], isError: true } })
      } else if (m.params.name === 'slow') {
        /* намеренно не отвечаем — проверяем таймаут */
      } else {
        send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'нет такого' } })
      }
    }
  }
})
function send (o) { process.stdout.write(JSON.stringify(o) + '\n') }
