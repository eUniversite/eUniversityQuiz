import express from 'express'
import compression from 'compression'
import { createServer } from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { engine } from './engine.js'
import { buildRouter, errorHandler } from './http.js'
import { attachSockets } from './sockets.js'

export async function createApp() {
  const app = express()
  if (config.trustProxy) app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' })
    next()
  })
  app.use(compression())
  // Le corps brut est conservé : la signature du webhook GeniusPay se calcule dessus.
  app.use(express.json({ limit: '200kb', verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = buf } }))
  app.use('/api', buildRouter())
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Introuvable.' }))

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }))
    app.get(/^(?!\/(api|socket\.io)).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  }
  app.use(errorHandler)

  const http = createServer(app)
  const io = attachSockets(http)
  await engine.start()
  return { app, http, io, close: async () => { engine.stop(); await new Promise((r) => io.close(r)) } }
}
