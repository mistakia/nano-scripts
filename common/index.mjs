import { fileURLToPath } from 'url'
import path from 'path'
import WebSocket from 'ws'

const __dirname = fileURLToPath(import.meta.url)
export const resultsPath = path.join(__dirname, '..', '..', 'results')
export const isMain = (path) => process.argv[1] === fileURLToPath(path)

export const getWebsocket = (wsUrl) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.on('open', () => {
      resolve(ws)
    })

    ws.on('error', (error) => reject(error))
  })
