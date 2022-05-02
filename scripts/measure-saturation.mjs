import { Worker } from 'worker_threads'
import path from 'path'
import debug from 'debug'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { wallet } from 'nanocurrency-web'
import { rpc, utils } from 'nano-rpc'
import { fileURLToPath } from 'url'
import WebSocket from 'ws'
import * as nanocurrency from 'nanocurrency'
import fs from 'fs-extra'
import PQueue from 'p-queue'

import { isMain, resultsPath } from '#common'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const argv = yargs(hideBin(process.argv)).argv
const __filename =
  path.dirname(fileURLToPath(import.meta.url)) +
  '/measure-saturation-worker.mjs'
const log = debug('measure-saturation')
debug.enable('measure-saturation')

const getWebsocket = (wsUrl) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.on('open', () => {
      resolve(ws)
    })

    ws.on('error', (error) => reject(error))
  })

const encodeBlock = (block) => {
  const buf = Buffer.alloc(216)
  buf.write(nanocurrency.derivePublicKey(block.account), 0, 32, 'hex')
  buf.write(block.previous, 32, 32, 'hex')
  buf.write(nanocurrency.derivePublicKey(block.representative), 64, 32, 'hex')
  const balance = BigInt(block.balance)
  buf.writeBigUInt64BE(balance >> 64n, 96)
  buf.writeBigUInt64BE(balance & 0xffffffffffffffffn, 104)
  buf.write(block.link, 112, 32, 'hex')
  buf.write(block.signature, 144, 64, 'hex')
  buf.writeBigUInt64BE(BigInt('0x' + block.work), 208)
  return buf
}

const run = async ({ seed, url, wsUrl, workerUrl, num_accounts = 5000 }) => {
  const ws = await getWebsocket(wsUrl)

  const start = 0
  const accounts = wallet.legacyAccounts(seed, start, num_accounts)
  const main_account = accounts.shift()
  log(`account #0: ${main_account.address}`)

  const main_account_info = await rpc(
    {
      action: 'account_info',
      account: main_account.address,
      representative: true
    },
    {
      url
    }
  )

  if (main_account_info.error) {
    if (main_account_info.error === 'Account not found') {
      throw new Error('Account 0 Unopened')
    } else {
      throw new Error(main_account_info.error)
    }
  }

  // verify main account balance
  if (BigInt(main_account_info.balance) < BigInt(1e30)) {
    throw new Error('Need at least 1 Nano in main account')
  }

  // open 5k accounts, starting at index 1
  const action = {
    action: 'accounts_frontiers',
    accounts: accounts.map((a) => a.address)
  }
  const res = await rpc(action, { url })
  const frontier_hashes = Object.values(res.frontiers)
  const unopened_count = frontier_hashes.filter(
    (f) => f === 'error: Account not found'
  ).length

  log(`Opened: ${num_accounts - unopened_count}, Unopened: ${unopened_count}`)

  let mainFrontier = main_account_info.frontier
  let mainBalance = main_account_info.balance
  const amount = 1e26
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i].address
    const frontier = frontier_hashes[i]

    // check if account unopened
    if (frontier === 'error: Account not found') {
      // check if receivable exists
      const res3 = await rpc(
        {
          action: 'receivable',
          account
        },
        {
          url
        }
      )

      // create send from main account
      let sendBlock
      let sendHash
      if (!res3.blocks || !res3.blocks.length) {
        sendBlock = await utils.createSendBlock({
          accountInfo: {
            ...main_account_info,
            frontier: mainFrontier,
            balance: mainBalance,
            account: main_account.address
          },
          to: account,
          amount,
          privateKey: main_account.privateKey,
          workerUrl
        })
        mainBalance = sendBlock.balance
        mainFrontier = sendHash = nanocurrency.hashBlock(sendBlock)

        await rpc(
          {
            action: 'process',
            json_block: true,
            async: true,
            block: sendBlock
          },
          {
            url
          }
        )
      }

      // create open for account
      const openBlock = await utils.createOpenBlock({
        account,
        hash: sendHash || res3.blocks[0],
        amount,
        publicKey: accounts[i].publicKey,
        privateKey: accounts[i].privateKey,
        workerUrl
      })

      await rpc(
        {
          action: 'process',
          json_block: true,
          async: true,
          block: openBlock
        },
        {
          url
        }
      )
    }
  }

  // create 5k change blocks (1 per account)
  log('Generating change blocks')
  const blockGenerationStart = process.hrtime.bigint()

  const action2 = {
    action: 'blocks_info',
    json_block: true,
    include_not_found: true,
    hashes: frontier_hashes
  }
  const res2 = await rpc(action2, { url })

  const blocks = []
  const queue = new PQueue({ concurrency: 20 })

  let count = 0
  for (let i = 0; i < accounts.length; i++) {
    queue.add(async () => {
      count += 1
      const account = accounts[i].address
      const frontier = frontier_hashes[i]
      const frontierBlock = res2.blocks[frontier]

      const derived_rep_from_frontier = nanocurrency
        .deriveAddress(frontier)
        .replace('xrb_', 'nano_')

      const changeBlock = await utils.createChangeBlock({
        accountInfo: {
          balance: frontierBlock.balance,
          frontier,
          account
        },
        rep: derived_rep_from_frontier,
        privateKey: accounts[i].privateKey,
        workerUrl
      })
      blocks.push({
        json: changeBlock,
        encoded: encodeBlock(changeBlock),
        hash: nanocurrency.hashBlock(changeBlock)
      })

      if (process.stdout.clearLine) {
        process.stdout.clearLine()
        process.stdout.cursorTo(0)
        process.stdout.write(
          `Generating change Blocks: ${count}/${accounts.length}`
        )
      }
    })
  }

  await queue.onIdle()

  process.stdout.write('\n')
  const blockGenerationEnd = process.hrtime.bigint()
  const blockGenerationDuration =
    (blockGenerationEnd - blockGenerationStart) / BigInt(1e9)
  log(
    `Block generation duration: ${Number(blockGenerationDuration).toFixed(
      2
    )} secs`
  )

  let broadcastEndTime
  let endTime
  let startTime
  let confirmation_counter = 0

  const worker = new Worker(__filename)
  worker.once('message', async (result) => {
    broadcastEndTime = result.broadcastEndTime
    startTime = result.startTime
    log(`Broadcast end time: ${broadcastEndTime}`)
    const broadcastDurationSecs = (broadcastEndTime - startTime) / BigInt(1e9)
    log(`Broadcast duration: ${Number(broadcastDurationSecs).toFixed(2)} secs`)
  })

  ws.on('message', (data) => {
    const d = JSON.parse(data)

    if (d.topic !== 'confirmation') return

    if (confirmation_counter === 0) {
      log('Received first confirmation')
    }

    confirmation_counter += 1
    if (process.stdout.clearLine) {
      process.stdout.clearLine()
      process.stdout.cursorTo(0)
      process.stdout.write(
        `Observed Confirmations: ${confirmation_counter}/${num_accounts}`
      )
    }

    if (confirmation_counter === num_accounts) {
      process.stdout.write('\n')
      endTime = process.hrtime.bigint()
      log(`End time: ${endTime}`)
      const totalDurationSecs = Number(
        (endTime - broadcastEndTime) / BigInt(1e9)
      )
      log(`Total duration: ${totalDurationSecs.toFixed(2)} secs`)
      log(
        `Observed saturation: ${(num_accounts / totalDurationSecs).toFixed(
          2
        )} blocks/sec`
      )

      const file = `${resultsPath}/measure-saturation.json`
      fs.ensureFileSync(file)
      const results = fs.readJsonSync(file, { throws: false }) || { data: [] }

      const result = {
        num_accounts,
        startTime: startTime.toString(),
        endTime: endTime.toString(),
        totalDurationSecs,
        cps: num_accounts / totalDurationSecs,
        timestamp: Math.floor(Date.now() / 10000)
      }

      log(`Savings results: ${file}`)
      fs.writeJsonSync(
        file,
        {
          data: [result, ...results.data]
        },
        {
          spaces: 2
        }
      )

      process.exit()
    }
  })

  ws.send(
    JSON.stringify({
      action: 'subscribe',
      topic: 'confirmation'
    })
  )

  await wait(10000)

  worker.postMessage({
    blocks,
    num_accounts
  })
}

const main = async () => {
  let error
  try {
    if (!argv.seed) {
      log('missing --seed')
      return
    }

    if (!argv.rpc) {
      log('missing --rpc')
      return
    }

    if (!argv.workerUrl) {
      log('missing --worker-url')
      return
    }

    // kill after given timeout
    if (argv.timeout) {
      setTimeout(() => {
        log(`Script timed out after ${argv.timeout} ms`)
        process.exit()
      }, argv.timeout)
    }

    await run({
      seed: argv.seed,
      url: argv.rpc,
      wsUrl: argv.wsUrl,
      workerUrl: argv.workerUrl,
      num_accounts: argv.count
    })
  } catch (err) {
    error = err
    console.log(error)
  }
}

if (isMain) {
  main()
}

export default run
