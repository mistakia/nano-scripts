import debug from 'debug'
import NanoNode, { NanoConstants } from 'nano-node-light'
import yargs from 'yargs'
import * as nanocurrency from 'nanocurrency'
import { rpc, utils } from 'nano-rpc'
import { hideBin } from 'yargs/helpers'

import { isMain } from '#common'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const argv = yargs(hideBin(process.argv)).argv
const log = debug('generate-checked')
debug.enable('generate-checked')

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

const generateChecked = async ({ account, url, privateKey, workerUrl, timeout }) => {
  // get account
  const account_info = await rpc({ action: 'account_info', account }, { url })
  account_info.account = account
  let frontier = account_info.frontier
  log(account_info)

  const network = NanoConstants.NETWORK.BETA
  const node = new NanoNode({ network, discover: false })

  node.on('error', (error) => {
    log(error)
  })

  node.connectAddress({
    address: '::ffff:116.202.107.97',
    port: '54000'
  })

  node.connectAddress({
    address: '::ffff:167.172.215.52',
    port: '54000'
  })

  await wait(5000)

  log(`Connected peers: ${node.peers.size}`)

  while (true) {
    const derived_rep_from_frontier = nanocurrency
      .deriveAddress(frontier)
      .replace('xrb_', 'nano_')

    const changeBlock = await utils.createChangeBlock({
      accountInfo: {
        balance: account_info.balance,
        frontier,
        account
      },
      rep: derived_rep_from_frontier,
      privateKey,
      workerUrl
    })

    log(changeBlock)

    frontier = nanocurrency.hashBlock(changeBlock)

    node.publish(encodeBlock(changeBlock))

    log(`Published ${frontier} to ${node.peers.size} peers`)

    await wait(timeout)
  }
}

const main = async () => {
  let error
  try {
    await generateChecked({
      account: argv.account,
      url: argv.url,
      privateKey: argv.privateKey,
      workerUrl: argv.workerUrl
    })
  } catch (err) {
    error = err
    console.log(error)
  }

  process.exit()
}

if (isMain(import.meta.url)) {
  main()
}

export default generateChecked
