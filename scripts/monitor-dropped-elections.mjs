import debug from 'debug'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { isMain, getWebsocket } from '#common'

const argv = yargs(hideBin(process.argv)).argv
const log = debug('monitor-dropped-elections')
debug.enable('monitor-dropped-elections')

const run = async ({ wsUrl }) => {
  const ws = await getWebsocket(wsUrl)

  let count = 0
  ws.on('message', (data) => {
    const d = JSON.parse(data)
    log(count++)
    log(d)
  })

  ws.send(
    JSON.stringify({
      action: 'subscribe',
      topic: 'stopped_election'
    })
  )
}
const main = async () => {
  let error
  try {
    await run({ wsUrl: argv.wsUrl })
  } catch (err) {
    error = err
    log(error)
  }
}

if (isMain(import.meta.url)) {
  main()
}

export default run
