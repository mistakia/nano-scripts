import debug from 'debug'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import crypto from 'crypto'
import { block } from 'nanocurrency-web'
import * as nanocurrency from 'nanocurrency'

import { isMain, rpc, constants } from '#common'

const argv = yargs(hideBin(process.argv)).argv
const log = debug('template')
debug.enable('template')

const generate_blockA = async ({ account_info, privateKey, workerUrl }) => {
  const derived_repA = nanocurrency
    .deriveAddress(account_info.frontier)
    .replace('xrb_', 'nano_')
  const blockA = {
    walletBalanceRaw: account_info.balance,
    address: account_info.account,
    representativeAddress: derived_repA,
    frontier: account_info.frontier,
    work: '0000000000000000'
  }
  const signed_blockA = block.representative(blockA, privateKey)
  const workA_res = await rpc.work_generate({
    hash: account_info.frontier,
    difficulty: constants.WORK_THRESHOLD_BETA,
    url: workerUrl
  })

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
  const workB_res = await rpc.work_generate({
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

const run = async ({ account, url, privateKey, workerUrl }) => {
  // get account
  const account_info = await rpc.account_info({ account, url })
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
  const total = 10000
  for (let i = 0; i < 10000; i++) {
    const fork = generate_fork({
      account_info,
      blockA_hash,
      privateKey,
      blockB_work: blockB.work
    })
    await rpc.process({ block: fork, url })
    process.stdout.write(`\rPublishing Forks: ${i}/${total}`)
  }
}

const main = async () => {
  let error
  try {
    const account = argv.account
    const url = argv.url
    const privateKey = argv.privateKey
    const workerUrl = argv.workerUrl

    await run({ account, url, privateKey, workerUrl })
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
