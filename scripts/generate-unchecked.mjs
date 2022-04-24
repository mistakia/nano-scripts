import debug from 'debug'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import crypto from 'crypto'
import { block } from 'nanocurrency-web'
import * as nanocurrency from 'nanocurrency'
import { Worker, isMainThread, parentPort } from 'worker_threads'
import { fileURLToPath } from 'url'
import PQueue from 'p-queue'
import os from 'os'
import rpc from 'nano-rpc'

import { isMain, constants } from '#common'

const argv = yargs(hideBin(process.argv)).argv
const log = debug('template')
debug.enable('template')

const generate_blockA = async ({ account_info, privateKey, workerUrl }) => {
  const blockA = {
    walletBalanceRaw: account_info.balance,
    address: account_info.account,
    representativeAddress:
      'nano_1111111111111111111111111111111111111111111111111111hifc8npp',
    frontier: account_info.frontier,
    work: '0000000000000000'
  }
  const signed_blockA = block.representative(blockA, privateKey)
  const workA_res = await rpc({
    action: 'work_generate',
    hash: account_info.frontier,
    difficulty: constants.WORK_THRESHOLD_BETA,
    url: workerUrl
  })

  signed_blockA.representative =
    'nano_1111111111111111111111111111111111111111111111111111hifc8npp'
  signed_blockA.work = workA_res.work

  return signed_blockA
}

const generate_blockB = async ({
  blockA_hash,
  account_info,
  privateKey,
  workerUrl
}) => {
  const derived_repB = nanocurrency
    .deriveAddress(blockA_hash)
    .replace('xrb_', 'nano_')

  const blockB = {
    walletBalanceRaw: account_info.balance,
    address: account_info.account,
    representativeAddress: derived_repB,
    frontier: blockA_hash,
    work: '0000000000000000'
  }
  const signed_blockB = block.representative(blockB, privateKey)
  const workB_res = await rpc({
    action: 'work_generate',
    hash: blockA_hash,
    difficulty: constants.WORK_THRESHOLD_BETA,
    url: workerUrl
  })

  signed_blockB.work = workB_res.work

  return signed_blockB
}

const generate_fork = ({
  account_info,
  blockA_hash,
  privateKey,
  blockB_work
}) => {
  const randomString = crypto.randomBytes(32).toString('hex')
  const derived_rep = nanocurrency
    .deriveAddress(randomString)
    .replace('xrb_', 'nano_')

  const forkB = {
    walletBalanceRaw: account_info.balance,
    address: account_info.account,
    representativeAddress: derived_rep,
    frontier: blockA_hash,
    work: blockB_work
  }
  const signed_forkB = block.representative(forkB, privateKey)

  return signed_forkB
}

const run = async ({
  account,
  url,
  privateKey,
  workerUrl,
  count = 10000,
  publish = false
}) => {
  // get account
  const account_info = await rpc({ action: 'account_info', account, url })
  account_info.account = account
  log(account_info)

  // generate next blockA
  const blockA = await generate_blockA({ account_info, privateKey, workerUrl })
  const blockA_hash = nanocurrency.hashBlock(blockA)

  // generate successor blockB
  const blockB = await generate_blockB({
    account_info,
    privateKey,
    workerUrl,
    blockA_hash
  })

  // generate forks for successor blockB
  const __filename = fileURLToPath(import.meta.url)
  const threads = os.cpus().length
  log(`using ${threads} threads`)

  const queue = new PQueue({ concurrency: threads })
  let i = 0
  const start_time = process.hrtime()
  log(start_time)

  const fork_worker = () =>
    new Promise((resolve, reject) => {
      i++
      const worker = new Worker(__filename)
      worker.once('message', async (fork) => {
        process.stdout.write(
          `\rPublishing Forks: ${i}/${count} (${(
            i / process.hrtime(start_time)[0]
          ).toFixed(1)} bps)\r`
        )
        resolve(fork)
      })

      worker.on('error', (error) => {
        log(error)
        reject(error)
      })

      worker.postMessage({
        account_info,
        blockA_hash,
        privateKey,
        blockB_work: blockB.work,
        url
      })
    })

  for (let i = 0; i < count; i++) {
    queue.add(fork_worker)
  }

  await queue.onIdle()

  if (publish) {
    await rpc({ action: 'process', block: blockA, url })
    log(`published blockA: ${blockA_hash}`)
    log(blockA)
  }
  log('done')
}

const main = async () => {
  let error
  try {
    const account = argv.account
    const url = argv.url
    const privateKey = argv.privateKey
    const workerUrl = argv.workerUrl
    const publish = argv.publish
    const count = argv.count

    await run({ account, url, privateKey, workerUrl, publish, count })
  } catch (err) {
    error = err
    console.log(error)
  }

  process.exit()
}

if (isMain && isMainThread) {
  main()
} else {
  parentPort.once('message', async (params) => {
    try {
      const fork = generate_fork(params)
      await rpc({
        action: 'process',
        block: fork,
        url: params.url,
        async: true
      })
      parentPort.postMessage(fork)
    } catch (err) {
      parentPort.postMessage(err)
    }
    process.exit()
  })
}

export default run
