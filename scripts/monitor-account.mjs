import debug from 'debug'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import NanoNode, { NanoConstants } from 'nano-node-light'

import { isMain } from '#common'

const argv = yargs(hideBin(process.argv)).argv
const log = debug('monitor-account')
debug.enable('monitor-account,node')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const connectToReps = (node) => {
  // NN1
  node.connectAddress({
    address: '::ffff:77.68.124.26',
    port: '7075'
  })

  // kraken
  node.connectAddress({
    address: '::ffff:52.24.24.124',
    port: '7075'
  })

  // natrium
  node.connectAddress({
    address: '::ffff:65.21.61.37',
    port: '7075'
  })

  // NF1
  node.connectAddress({
    address: '::ffff:172.105.228.96',
    port: '7075'
  })

  // 3oxho
  node.connectAddress({
    address: '2a01:4f8:161:6093::2',
    port: '7075'
  })

  // nanowallet
  node.connectAddress({
    address: '::ffff:138.68.165.210',
    port: '7075'
  })

  // NN2
  node.connectAddress({
    address: '::ffff:145.224.65.26',
    port: '7075'
  })

  // NF2
  node.connectAddress({
    address: '::ffff:94.16.109.134',
    port: '7075'
  })

  // nanocrawler
  node.connectAddress({
    address: '2a01:4f8:c2c:347::1',
    port: '7075'
  })

  // nanocharts
  node.connectAddress({
    address: '::ffff:173.249.54.87',
    port: '7075'
  })

  // nanoticker
  node.connectAddress({
    address: '::ffff:202.61.250.18',
    port: '7075'
  })

  // nanowallets.guide
  node.connectAddress({
    address: '::ffff:65.21.104.141',
    port: '7075'
  })

  // nano germany
  node.connectAddress({
    address: '::ffff:116.202.52.114',
    port: '7075'
  })

  // atomic wallet
  node.connectAddress({
    address: '::ffff:147.135.97.16',
    port: '7075'
  })

  // power node
  node.connectAddress({
    address: '::ffff:209.89.187.162',
    port: '7075'
  })

  // wenano
  node.connectAddress({
    address: '::ffff:78.47.124.255',
    port: '7075'
  })

  // kappture
  node.connectAddress({
    address: '::ffff:54.77.3.59',
    port: '7075'
  })

  // NF6
  node.connectAddress({
    address: '2a01:4f9:4a:2593::2',
    port: '7075'
  })

  // nano voting
  node.connectAddress({
    address: '::ffff:162.55.62.26',
    port: '7075'
  })

  // nano italia
  node.connectAddress({
    address: '::ffff:77.72.193.181',
    port: '7075'
  })
}

const run = async () => {
  const network = NanoConstants.NETWORK.LIVE
  const node = new NanoNode({ network, maxPeers: Infinity, discover: false })

  node.on('error', (err) => log(err))

  connectToReps(node)
  await wait(5000)

  log(`Connected peers: ${node.peers.size}`)
}

const main = async () => {
  let error
  try {
    await run()
  } catch (err) {
    error = err
    console.log(error)
  }
}

if (isMain(import.meta.url)) {
  main()
}

export default run
