import { parentPort } from 'worker_threads'
import NanoNode, { NanoConstants } from 'nano-node-light'
import debug from 'debug'

const log = debug('measure-saturation-worker')
debug.enable('measure-saturation-worker')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

parentPort.once('message', async ({ blocks, num_accounts }) => {
  const network = NanoConstants.NETWORK.BETA
  const node = new NanoNode({ network, maxPeers: Infinity })

  node.on('error', () => {
    // ignore
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

  // sample time
  const startTime = process.hrtime.bigint()
  log(`Broadcast start time: ${startTime}`)

  // broadcast blocks
  let broadcastEndTime
  let totalWriteCounter = 0
  let totalDrainCounter = 0
  const writeCounter = {}
  const onSent = (peerAddress) => {
    totalDrainCounter += 1
    if (writeCounter[peerAddress]) {
      writeCounter[peerAddress] += 1

      if (writeCounter[peerAddress] === num_accounts) {
        const peer = node.peers.get(peerAddress)
        if (peer) {
          peer.nanoSocket.close()
        }

        // sample time when first peer receives all blocks
        if (!broadcastEndTime) {
          parentPort.postMessage({
            startTime,
            broadcastEndTime: process.hrtime.bigint()
          })
        }
      }
    } else {
      writeCounter[peerAddress] = 1
    }

    if (totalWriteCounter === totalDrainCounter) {
      node.stop()
      log('Node stopped')
      process.exit()
    }
  }

  for (const block of blocks) {
    for (const peer of node.peers.values()) {
      totalWriteCounter += 1
      peer.nanoSocket.sendMessage({
        messageType: NanoConstants.MESSAGE_TYPE.PUBLISH,
        message: block.encoded,
        extensions: 0x600,
        onSent: () => onSent(peer.address)
      })
    }
  }
})
