const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const { createOfficeRpcServer } = require('./office-rpc.cjs')

async function call(port, { channel, args = [], token }) {
  const body = JSON.stringify({ channel, args })
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port, path: '/rpc', method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }))
    })
    request.on('error', reject)
    request.end(body)
  })
}

test('office RPC authenticates independently, checks permissions server-side, and rejects unknown methods', async (t) => {
  const known = new Set(['auth:status', 'auth:login', 'auth:logout', 'accounts:list', 'accounts:remove'])
  const server = createOfficeRpcServer({
    tls: { key: 'test-key', cert: 'test-cert' },
    host: '127.0.0.1', port: 0, serverFactory: http.createServer,
    permissionFor: (channel) => channel === 'accounts:list' ? 'Chart of Accounts' : channel === 'accounts:remove' ? 'Chart of Accounts' : channel.startsWith('auth:') ? null : undefined,
    dispatch: async (channel, args) => {
      assert.ok(known.has(channel), `unexpected dispatch channel ${channel}`)
      if (channel === 'auth:status') return { hasUsers: true, hasCompanyProfile: true }
      if (channel === 'auth:login') return args[0] === 'operator'
        ? { username: 'operator', permissions: ['Overview'] }
        : { username: 'manager', permissions: ['Overview', 'Chart of Accounts'] }
      if (channel === 'accounts:list') return ['account list']
      return null
    },
  })
  t.after(() => server.close())
  const address = await server.listen()

  const status = await call(address.port, { channel: 'auth:status' })
  assert.equal(status.status, 200)
  assert.equal(status.body.value.session, null)

  const operator = await call(address.port, { channel: 'auth:login', args: ['operator'] })
  assert.equal(operator.status, 200)
  assert.equal(operator.body.value.username, 'operator')
  assert.ok(operator.body.token)

  const blocked = await call(address.port, { channel: 'accounts:list', token: operator.body.token })
  assert.equal(blocked.status, 403)

  const manager = await call(address.port, { channel: 'auth:login', args: ['manager'] })
  const allowed = await call(address.port, { channel: 'accounts:list', token: manager.body.token })
  assert.deepEqual(allowed.body.value, ['account list'])

  const unknown = await call(address.port, { channel: 'shell:execute', token: manager.body.token })
  assert.equal(unknown.status, 404)

  const noSession = await call(address.port, { channel: 'accounts:list' })
  assert.equal(noSession.status, 401)
})
