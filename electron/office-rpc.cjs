const https = require('node:https')
const crypto = require('node:crypto')

const MAX_BODY_BYTES = 2 * 1024 * 1024
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000

function createOfficeRpcServer({ tls, host = '0.0.0.0', port = 48391, permissionFor, refreshSession = (session) => session, dispatch, serverFactory = https.createServer }) {
  if (!tls?.key || !tls?.cert) throw new Error('TLS key and certificate are required')
  if (typeof permissionFor !== 'function' || typeof dispatch !== 'function') throw new Error('RPC permission and dispatch functions are required')

  const sessions = new Map()
  const loginFailures = new Map()
  let dispatchQueue = Promise.resolve()

  const enqueue = (task) => {
    const result = dispatchQueue.then(task, task)
    dispatchQueue = result.catch(() => undefined)
    return result
  }

  const server = serverFactory(tls, (request, response) => {
    const send = (status, value) => {
      const body = Buffer.from(JSON.stringify(value))
      response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': body.length,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      response.end(body)
    }

    if (request.method !== 'POST' || request.url !== '/rpc') return send(404, { error: 'Not found' })
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return send(415, { error: 'Expected JSON request' })

    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        send(413, { error: 'Request is too large' })
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', async () => {
      if (response.writableEnded) return
      try {
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const { channel, args } = input || {}
        if (typeof channel !== 'string' || !Array.isArray(args) || channel.length > 100) return send(400, { error: 'Invalid RPC request' })

        const bearer = String(request.headers.authorization || '').match(/^Bearer ([A-Za-z0-9_-]{40,})$/)?.[1]
        let current = bearer ? sessions.get(bearer) : null
        const now = Date.now()
        if (current && current.expiresAt <= now) { sessions.delete(bearer); current = null }
        if (current) {
          const refreshed = await refreshSession(current.session)
          if (!refreshed) { sessions.delete(bearer); current = null }
          else current.session = refreshed
        }

        if (channel === 'auth:status') {
          const value = await enqueue(() => dispatch(channel, args, current?.session ?? null))
          return send(200, { value: { ...value, session: current?.session ?? null } })
        }

        if (channel === 'auth:setup' || channel === 'auth:login') {
          const address = request.socket.remoteAddress || 'unknown'
          const failures = loginFailures.get(address)
          if (failures && failures.until > now && failures.count >= 8) return send(429, { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' })
          let session
          try {
            session = await enqueue(() => dispatch(channel, args, null))
            loginFailures.delete(address)
          } catch (error) {
            const currentFailures = loginFailures.get(address)
            const count = currentFailures?.until > now ? currentFailures.count + 1 : 1
            if (loginFailures.size >= 512 && !loginFailures.has(address)) loginFailures.delete(loginFailures.keys().next().value)
            loginFailures.set(address, { count, until: now + 15 * 60 * 1000 })
            throw error
          }
          const token = crypto.randomBytes(32).toString('base64url')
          sessions.set(token, { session, expiresAt: now + SESSION_LIFETIME_MS })
          return send(200, { value: session, token })
        }

        if (!current || current.expiresAt <= now) return send(401, { error: 'Sign-in expired. Please sign in again.' })
        const permission = permissionFor(channel, args)
        if (permission === undefined) return send(404, { error: 'Unsupported operation' })
        if (permission && !(Array.isArray(permission)
          ? permission.some((item) => current.session.permissions.includes(item))
          : current.session.permissions.includes(permission))) return send(403, { error: 'Your account does not have permission for this operation' })

        current.expiresAt = now + SESSION_LIFETIME_MS
        const value = await enqueue(() => dispatch(channel, args, current.session))
        if (channel === 'auth:logout') sessions.delete(bearer)
        return send(200, { value })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Request failed'
        return send(400, { error: message.slice(0, 500) })
      }
    })
  })

  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          server.removeListener('error', reject)
          resolve(server.address())
        })
      })
    },
    close() {
      sessions.clear()
      return new Promise((resolve, reject) => {
        if (!server.listening) return resolve()
        server.close((error) => error ? reject(error) : resolve())
      })
    },
    address: () => server.address(),
  }
}

module.exports = { createOfficeRpcServer, MAX_BODY_BYTES, SESSION_LIFETIME_MS }
