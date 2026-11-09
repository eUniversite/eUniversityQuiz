import { config } from './config.js'
import { createApp } from './app.js'
import { startStudyWorker } from './study/queue.js'

const { http } = await createApp()
await startStudyWorker()
http.listen(config.port, '0.0.0.0', () => console.log(`eUniversité Live — serveur sur http://localhost:${config.port}`))
