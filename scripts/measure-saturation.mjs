import debug from 'debug'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { wallet, block } from 'nanocurrency-web'
import rpc from 'nano-rpc'
import WebSocket from 'ws'
import * as nanocurrency from 'nanocurrency'
import crypto from 'crypto'
import fs from 'fs-extra'

import NanoNode, { NanoConstants } from 'nano-node-light'

import { isMain, constants } from '#common'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const argv = yargs(hideBin(process.argv)).argv
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

const createSendBlock = async ({
  accountInfo,
  to,
  amount,
  privateKey,
  workerUrl
}) => {
  const data = {
    walletBalanceRaw: accountInfo.balance,
    fromAddress: accountInfo.account,
    toAddress: to,
    representativeAddress: constants.BURN_ACCOUNT,
    frontier: accountInfo.frontier,
    amountRaw: amount
  }

  const action = {
    action: 'work_generate',
    hash: accountInfo.frontier,
    difficulty: constants.WORK_THRESHOLD_BETA
  }
  const res = await rpc(action, { url: workerUrl })

  data.work = res.work

  return block.send(data, privateKey)
}

const createReceiveBlock = async ({
  accountInfo,
  hash,
  amount,
  privateKey,
  workerUrl
}) => {
  const data = {
    walletBalanceRaw: accountInfo.balance,
    toAddress: accountInfo.account,
    representativeAddress: constants.BURN_ACCOUNT,
    frontier: accountInfo.frontier,
    transactionHash: hash,
    amountRaw: amount
  }

  const action = {
    action: 'work_generate',
    hash: accountInfo.frontier,
    difficulty: constants.WORK_THRESHOLD_BETA
  }
  const res = await rpc(action, { url: workerUrl })

  data.work = res.work

  return block.receive(data, privateKey)
}

const createOpenBlock = async ({
  account,
  hash,
  amount,
  publicKey,
  privateKey,
  workerUrl
}) => {
  const data = {
    walletBalanceRaw: '0',
    toAddress: account,
    representativeAddress: constants.BURN_ACCOUNT,
    frontier: constants.ZEROS,
    transactionHash: hash,
    amountRaw: amount
  }

  const action = {
    action: 'work_generate',
    hash: publicKey,
    difficulty: constants.WORK_THRESHOLD_BETA
  }
  const res = await rpc(action, { url: workerUrl })

  data.work = res.work

  return block.receive(data, privateKey)
}

const createChangeBlock = async ({
  accountInfo,
  rep,
  privateKey,
  workerUrl
}) => {
  const data = {
    walletBalanceRaw: accountInfo.balance,
    address: accountInfo.account,
    representativeAddress: rep,
    frontier: accountInfo.frontier
  }

  const res = await rpc(
    {
      action: 'work_generate',
      hash: accountInfo.frontier,
      difficulty: constants.WORK_THRESHOLD_BETA
    },
    {
      url: workerUrl
    }
  )

  data.work = res.work

  return block.representative(data, privateKey)
}

// broadcasts a block and waits for its confirmation
const confirmBlock = ({ ws, block, hash, url }) =>
  new Promise((resolve, reject) => {
    // register confirmation listener
    const listener = (data) => {
      console.log(JSON.parse(data))
      const d = JSON.parse(data)
      if (d.topic !== 'confirmation') return
      if (d.message.hash !== hash) return

      // update websocket subscription
      ws.send(
        JSON.stringify({
          action: 'update',
          topic: 'confirmation',
          options: {
            accounts_del: [block.account]
          }
        })
      )

      // unregister event listener
      ws.off('message', listener)

      resolve(hash)
    }

    ws.on('message', listener)

    // register node websocket subscription
    ws.send(
      JSON.stringify({
        action: 'update',
        topic: 'confirmation',
        options: {
          accounts_add: [block.account]
        }
      })
    )

    // broadcast block
    rpc(
      {
        action: 'process',
        json_block: true,
        async: true,
        block
      },
      {
        url
      }
    )
  })

const run = async ({ seed, url, wsUrl, workerUrl }) => {
  const ws = await getWebsocket(wsUrl)

  const start = 0
  const num_accounts = 5000
  const accounts = wallet.legacyAccounts(seed, start, num_accounts)
  const main_account = accounts.shift()
  log(`account #0: ${main_account.address}`)

  ws.send(
    JSON.stringify({
      action: 'subscribe',
      topic: 'confirmation',
      options: {
        accounts: [main_account.address]
      }
    })
  )

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
  const res2 = await rpc(action, { url })
  const frontier_hashes = Object.values(res2.frontiers)
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
        sendBlock = await createSendBlock({
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

        // await confirmBlock({ ws, block: sendBlock, hash: sendHash, url })
      }

      // create open for account
      const openBlock = await createOpenBlock({
        account,
        hash: sendHash || res3.blocks[0],
        amount,
        publicKey: accounts[i].publicKey,
        privateKey: accounts[i].privateKey,
        workerUrl
      })
      const openHash = nanocurrency.hashBlock(openBlock)

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

      //await confirmBlock({ ws, block: openBlock, hash: openHash, url })
    }
  }

  // check disk for cache of blocks
  const file = './saturation-cache.json'
  let cache = fs.pathExistsSync(file) ? fs.readJsonSync(file) : null

  // valid previous matches frontiers
  if (!cache || cache.account !== main_account.address) {
    log('Block cache not found, generating change blocks')
    const blockGenerationStart = process.hrtime.bigint()

    // create 5k change blocks (1 per account)
    const res = await rpc(
      {
        action: 'blocks_info',
        json_block: true,
        include_not_found: true,
        hashes: frontier_hashes
      },
      {
        url
      }
    )

    const blocks = []
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i].address
      const frontier = frontier_hashes[i]
      const frontierBlock = res.blocks[frontier]

      const derived_rep_from_frontier = nanocurrency
        .deriveAddress(frontier)
        .replace('xrb_', 'nano_')

      const changeBlock = await createChangeBlock({
        accountInfo: {
          balance: frontierBlock.balance,
          frontier,
          account
        },
        rep: derived_rep_from_frontier,
        privateKey: accounts[i].privateKey,
        workerUrl
      })
      const encoded = encodeBlock(changeBlock)
      blocks.push({
        json: changeBlock,
        encoded: encoded.toString('hex'),
        hash: nanocurrency.hashBlock(changeBlock)
      })

      process.stdout.clearLine()
      process.stdout.cursorTo(0)
      process.stdout.write(`Generating change Blocks: ${i}/${accounts.length}`)
    }

    process.stdout.write('\n')
    const blockGenerationEnd = process.hrtime.bigint()
    const blockGenerationDuration = (blockGenerationEnd - blockGenerationStart) / BigInt(1e9)
    log(`Block generation duration: ${Number(blockGenerationDuration).toFixed(2)} secs`)

    // save to disk
    cache = {
      account: main_account.address,
      blocks
    }
    fs.writeJsonSync(file, cache, {
      spaces: 2
    })
  }

  const network = NanoConstants.NETWORK.BETA
  const node = new NanoNode({ network, maxPeers: 1 })

  node.on('error', (error) => {
    // console.log(error)
  })

  node.connect({
    address: '::ffff:194.146.12.171', //network.ADDRESS,
    port: '54000' // network.PORT
  })

  await wait(5000)

  log(`Connected peers: ${node.peers.size}`)

  // new websocket subscription
  ws.send(
    JSON.stringify({
      action: 'subscribe',
      topic: 'confirmation'
    })
  )

  await wait(5000)

  // sample time
  const startTime = process.hrtime.bigint()
  log(`Start time: ${startTime}`)

  let confirmation_counter = 0
  let endTime
  let broadcastEndTime
  ws.on('message', (data) => {
    const d = JSON.parse(data)

    if (d.topic !== 'confirmation') return
    confirmation_counter += 1
    process.stdout.clearLine()
    process.stdout.cursorTo(0)
    process.stdout.write(`Observed Confirmations: ${confirmation_counter}/${num_accounts}`)

    if (confirmation_counter === num_accounts) {
      process.stdout.write('\n')
      endTime = process.hrtime.bigint()
      log(`End time: ${endTime}`)
      const totalDurationSecs = Number((endTime - startTime) / BigInt(1e9))
      log(`Total duration: ${totalDurationSecs.toFixed(2)} secs`)
      log(`Observed saturation: ${(num_accounts / totalDurationSecs).toFixed(2)} blocks/sec`)

      process.exit()
    }
  })

  // broadcast blocks
  const peerCount = 1
  for (const block of cache.blocks) {
    const buf = Buffer.from(block.encoded, 'hex')

    node.publish(buf, peerCount)
  }

  // sample time
  broadcastEndTime = process.hrtime.bigint()
  log(`Broadcast end time: ${broadcastEndTime}`)
  const broadcastDurationSecs = (broadcastEndTime - startTime) / BigInt(1e9)
  log(`Broadcast duration: ${Number(broadcastDurationSecs).toFixed(2)} secs`)
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

    await run({
      seed: argv.seed,
      url: argv.rpc,
      wsUrl: argv.wsUrl,
      workerUrl: argv.workerUrl
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
