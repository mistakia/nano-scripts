import debug from 'debug'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { wallet } from 'nanocurrency-web'
import rpc from 'nano-rpc'
import WebSocket from 'ws'

import { isMain } from '#common'

const argv = yargs(hideBin(process.argv)).argv
const log = debug('template')
debug.enable('template')

const getWebsocket = (wsUrl) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.on('open', () => {
      resolve(ws)
    })

    ws.on('error', (error) => reject(error))
  })

const confirmBlock = ({ ws, block, hash }) =>
  new Promise((resolve, reject) => {
    // register confirmation listener
    const listener = (data) => {
      console.log(data)
      if (data.topic !== 'confirmation') return
      if (data.message.hash !== hash) return

      // update websocket subscription
      ws.send({
        action: 'update',
        topic: 'confirmation',
        options: {
          accounts_del: [block.account]
        }
      })

      // unregister event listener
      ws.off('message', listener)

      resolve(hash)
    }

    ws.on('message', listener)

    // register node websocket subscription
    ws.send({
      action: 'update',
      topic: 'confirmation',
      options: {
        accounts_add: [block.account]
      }
    })

    // broadcast block
    rpc({
      action: 'process',
      json_block: true,
      block
    })
  })

const run = async ({ seed, url, wsUrl }) => {
  const ws = await getWebsocket(wsUrl)

  const start = 0
  const end = 5000
  const accounts = wallet.legacyAccounts(seed, start, end)
  const main_account = accounts.shift()
  console.log(main_account)
  const res = await rpc(
    {
      action: 'account_info',
      account: main_account.address
    },
    {
      url
    }
  )
  console.log(res)

  if (res.error) {
    if (res.error === 'Account not found') {
      throw new Error('Account 0 Unopened')
    } else {
      throw new Error(res.error)
    }
  }

  // verify main account balance
  if (BigInt(res.balance) < BigInt(1e30)) {
    throw new Error('Need at least 1 Nano in main account')
  }

  // open 5k accounts, starting at index 1
  const action = {
    action: 'accounts_frontiers',
    accounts: accounts.map((a) => a.address)
  }
  const res2 = await rpc(action, { url })
  for (const [account, frontier] of Object.entries(res2.frontiers)) {
    // check if account unopened
    if (frontier === 'error: Account not found') {
      // create send from main account
      // create open for account
    }
  }

  // check disk for cache of blocks
  // valid previous matches frontiers
  // if needed, create 5k change blocks (1 per account)
  // save to disk

  // sample time
  // broadcast blocks
  // sample time
  // wait for 5k confirmations
  // sample time
}

const main = async () => {
  let error
  try {
    const seed = argv.seed
    if (!seed) {
      log('missing --seed')
      return
    }

    const rpc_url = argv.rpc
    if (!rpc_url) {
      log('missing --rpc')
      return
    }

    await run({ seed, url: rpc_url, wsUrl: argv.wsUrl })
  } catch (err) {
    error = err
    console.log(error)
  }

  process.exit()
}

if (isMain) {
  main()
}

export default run
