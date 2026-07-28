/**
 * Минимальный MCP-сервер по HTTP (Streamable HTTP) — для проверки клиента.
 *
 * Намеренно отвечает ДВУМЯ разными способами: часть ответов одиночным JSON,
 * часть — потоком событий. Спецификация разрешает и то и другое, а клиент
 * обязан понимать оба, и проверять это надо на настоящем сервере.
 */
const http = require('http')

const SESSION = 'proba-sessii-123'
const TOOLS = [
  { name: 'echo', title: 'Эхо', description: 'повторяет', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'boom', description: 'всегда падает', inputSchema: { type: 'object' } }
]

function sendJson (res, body, extra = {}) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': SESSION, ...extra })
  res.end(JSON.stringify(body))
}

/** Тот же ответ, но потоком событий — и с уведомлением перед ним. */
function sendStream (res, body) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': SESSION })
  res.write('data: ' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info' } }) + '\n\n')
  res.write('data: ' + JSON.stringify(body) + '\n\n')
  res.end()
}

const server = http.createServer((req, res) => {
  if (req.method === 'DELETE') { res.writeHead(200); res.end(); return }
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return }

  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const accept = req.headers.accept || ''
    // клиент ОБЯЗАН перечислять оба типа — иначе это нарушение спецификации
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
      res.writeHead(400); res.end('плохой Accept: ' + accept); return
    }
    let m
    try { m = JSON.parse(raw) } catch { res.writeHead(400); res.end(); return }

    if (m.id === undefined) { res.writeHead(202); res.end(); return } // уведомление

    if (m.method === 'initialize') {
      sendJson(res, { jsonrpc: '2.0', id: m.id, result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'fake-http', version: '1' }
      } })
      return
    }
    if (m.method === 'tools/list') {
      // список отдаём ПОТОКОМ — проверяем разбор событий
      sendStream(res, { jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } })
      return
    }
    if (m.method === 'tools/call') {
      if (!req.headers['mcp-session-id']) { res.writeHead(400); res.end('нет сессии'); return }
      const name = m.params && m.params.name
      if (name === 'echo') {
        sendJson(res, { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'эхо: ' + m.params.arguments.text }] } })
      } else if (name === 'boom') {
        sendStream(res, { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'внутренняя поломка' }], isError: true } })
      } else if (name === 'otkrytyy') {
        // ответ есть, но поток НЕ закрываем — так делать спецификация разрешает
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': SESSION })
        res.write('data: ' + JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'ответ пришёл сразу' }] } }) + '\n\n')
        // намеренно держим соединение открытым
      } else if (name === 'slow') {
        /* намеренно молчим — проверяем таймаут */
      } else {
        sendJson(res, { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'нет такого' } })
      }
      return
    }
    sendJson(res, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'не поддерживается' } })
  })
})

server.listen(Number(process.argv[2] || 0), '127.0.0.1', () => {
  process.stdout.write('PORT=' + server.address().port + '\n')
})
