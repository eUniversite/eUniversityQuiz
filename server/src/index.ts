import { config } from './config.js'
import { createApp } from './app.js'
import { startStudyWorker } from './study/queue.js'
import { startBillingWorker } from './billing/index.js'

const { http } = await createApp()
await startStudyWorker()
startBillingWorker()
http.listen(config.port, '0.0.0.0', () => console.log(`eUniversité Live — serveur sur http://localhost:${config.port}`))
