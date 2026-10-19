const https = require('node:https')
const crypto = require('node:crypto')

function normalizeFingerprint(value) {
  const fingerprint = String(value || '').replaceAll(':', '').replaceAll(/\s+/g, '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Server certificate fingerprint must be 64 hexadecimal characters')
  return fingerprint
}

function createOfficeRemoteClient({ url, fingerprint }) {
  const endpoint = new URL(url)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new Error('Office server address must be an HTTPS origin, such as https://192.168.1.20:48391')
  }
  const expectedFingerprint = normalizeFingerprint(fingerprint)
  let token = null

  function request(channel, args) {
    const body = Buffer.from(JSON.stringify({ channel, args }))
    return new Promise((resolve, reject) => {
      const request = https.request({
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port || 443,
        path: '/rpc',
        method: 'POST',
        agent: false,
        rejectUnauthorized: false,
        headers: { 'content-type': 'application/json', 'content-length': body.length, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        timeout: 15_000,
      }, (response) => {
        const chunks = []
        let size = 0
        response.on('data', (chunk) => {
          size += chunk.length
          if (size > 2 * 1024 * 1024) request.destroy(new Error('Office server response is too large'))
          else chunks.push(chunk)
        })
        response.on('end', () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if ((response.statusCode || 500) >= 400) return reject(new Error(payload.error || `Office server returned ${response.statusCode}`))
            resolve(payload)
          } catch (error) { reject(error) }
        })
      })
      request.on('timeout', () => request.destroy(new Error('Office server connection timed out')))
      request.on('error', reject)
      request.on('socket', (socket) => {
        socket.once('secureConnect', () => {
          const certificate = socket.getPeerCertificate(true)
          const actual = certificate?.raw && crypto.createHash('sha256').update(certificate.raw).digest('hex')
          if (actual !== expectedFingerprint) request.destroy(new Error('Office server certificate does not match the trusted fingerprint'))
          else request.end(body)
        })
      })
    })
  }

  return {
    async invoke(channel, args = []) {
      if (channel === 'auth:login' || channel === 'auth:setup') {
        token = null
        const response = await request(channel, args)
        token = response.token
        return response.value
      }
      const response = await request(channel, args)
      if (channel === 'auth:status') token = response.value?.session ? token : null
      if (channel === 'auth:logout') token = null
      return response.value
    },
  }
}

module.exports = { createOfficeRemoteClient, normalizeFingerprint }
