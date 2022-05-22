import debug from 'debug'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { rpc, utils } from 'nano-rpc'
import { wallet } from 'nanocurrency-web'
import * as nanocurrency from 'nanocurrency'
import PQueue from 'p-queue'
import NanoNode, { NanoConstants } from 'nano-node-light'

import { isMain } from '#common'

const argv = yargs(hideBin(process.argv)).argv
const log = debug('template')
debug.enable('template')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
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

const run = async ({ seed, url, workerUrl, num_accounts = 5000, setup = false }) => {
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
  const open_amount = 1e26
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
          amount: open_amount,
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
        amount: open_amount,
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

  if (setup) {
    process.exit()
  }

  const network = NanoConstants.NETWORK.BETA
  const node = new NanoNode({ network, maxPeers: Infinity, discover: false })

  node.on('error', (err) => {
    log(error)
  })

  node.connectAddress({
    address: '::ffff:116.202.107.97',
    port: '54000'
  })

  node.connectAddress({
    addresss: '::ffff:194.146.12.171',
    port: '54000'
  })

  await wait(5000)

  log(`Connected peers: ${node.peers.size}`)

  // create send blocks (1 per account)
  log('Generating send blocks')

  let count = 0
  const spam_amount = 1
  while (true) {
    const action = {
      action: 'accounts_frontiers',
      accounts: accounts.map((a) => a.address)
    }
    const res = await rpc(action, { url })
    const frontier_hashes = Object.values(res.frontiers)

    const action2 = {
      action: 'blocks_info',
      json_block: true,
      include_not_found: true,
      hashes: frontier_hashes
    }
    const res2 = await rpc(action2, { url })

    const queue = new PQueue({ concurrency: 20 })

    for (let i = 0; i < accounts.length; i++) {
      queue.add(async () => {
        count += 1
        const account = accounts[i].address
        const frontier = frontier_hashes[i]
        const frontierBlock = res2.blocks[frontier]

        const sendBlock = await utils.createSendBlock({
          accountInfo: {
            balance: frontierBlock.balance,
            frontier,
            account
          },
          to: main_account.address,
          amount: spam_amount,
          privateKey: accounts[i].privateKey,
          workerUrl
        })

        const message = encodeBlock(sendBlock)

        for (const peer of node.peers.values()) {
          if (!peer) continue
          peer.nanoSocket.sendMessage({
            messageType: NanoConstants.MESSAGE_TYPE.PUBLISH,
            message,
            extensions: 0x600
          })
        }

        if (process.stdout.clearLine) {
          process.stdout.clearLine()
          process.stdout.cursorTo(0)
          process.stdout.write(
            `Broadcasting send Blocks: ${count}/${accounts.length}`
          )
        }
      })
    }
  }

  /* process.stdout.write('\n')
   * const blockGenerationEnd = process.hrtime.bigint()
   * const blockGenerationDuration =
   *   (blockGenerationEnd - blockGenerationStart) / BigInt(1e9)
   * log(
   *   `Block generation duration: ${Number(blockGenerationDuration).toFixed(
   *     2
   *   )} secs`
   * )

   * let broadcastEndTime
   * let totalWriteCounter = 0
   * let totalDrainCounter = 0
   * const writeCounter = {}
   * const onSent = (peerAddress) => {
   *   totalDrainCounter += 1
   *   if (writeCounter[peerAddress]) {
   *     writeCounter[peerAddress] += 1

   *     if (writeCounter[peerAddress] === num_accounts) {
   *       const peer = node.peers.get(peerAddress)
   *       if (peer) {
   *         peer.nanoSocket.close()
   *       }

   *       if (totalWriteCounter === totalDrainCounter) {
   *         node.stop()
   *         log('Node stopped')

   *         broadcastEndTime = process.hrtime.bigint()
   *         log(`Broadcast end time: ${broadcastEndTime}`)
   *         const broadcastDurationSecs = (broadcastEndTime - startTime) / BigInt(1e9)
   *         log(`Broadcast duration: ${Number(broadcastDurationSecs).toFixed(2)} secs`)

   *         process.exit()
   *       }
   *     }
   *   } else {
   *     writeCounter[peerAddress] = 1
   *   }
   * }

   * const startTime = process.hrtime.bigint()
   * let last_block = startTime
   * const rate = BigInt(Math.floor(1e9 / 25))
   * for (const block of blocks) {
   *   const current_time = process.hrtime.bigint()
   *   const elapsed = current_time - last_block
   *   if (elapsed < rate) {
   *     await wait(Number((rate - elapsed) / BigInt(1e+6)))
   *   }

   *   last_block = process.hrtime.bigint()

   *   for (const peer of node.peers.values()) {
   *     if (!peer) continue
   *     totalWriteCounter += 1
   *     peer.nanoSocket.sendMessage({
   *       messageType: NanoConstants.MESSAGE_TYPE.PUBLISH,
   *       message: block.encoded,
   *       extensions: 0x600,
   *       onSent: () => onSent(peer.connectionInfo.toString('binary'))
   *     })
   *   }
   * } */
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
      num_accounts: argv.count,
      setup: argv.setup
    })
  } catch (err) {
    error = err
    console.log(error)
  }
}

if (isMain(import.meta.url)) {
  main()
}

export default run
