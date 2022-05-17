import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import fs from 'fs-extra'
import { rpc, constants } from 'nano-rpc'
import dayjs from 'dayjs'
import debug from 'debug'

import { isMain } from '#common'

const argv = yargs(hideBin(process.argv)).argv

const logger = debug('script')
debug.enable('script')

const batchSize = 1000
let addressCount = 0
let account = argv.start || constants.BURN_ACCOUNT
const differences = []

if (!argv.rpc1) {
  logger('missing --rpc1')
  process.exit()
}

if (!argv.rpc2) {
  logger('missing --rpc2')
  process.exit()
}

if (!argv.days) {
  logger('missing --days')
  process.exit()
}

const modified_since = dayjs().subtract(argv.days, 'days').unix()

const run = async () => {
  do {
    logger(`fetching ledger with ${account}, modified_since: ${modified_since}`)

    const { accounts } = await rpc(
      {
        action: 'ledger',
        account,
        modified_since,
        count: batchSize
      },
      {
        url: argv.rpc1
      }
    )

    const addresses = Object.keys(accounts)
    addressCount = addresses.length

    // set account for next batch
    account = addresses[addressCount - 1]

    logger(`received ${addressCount} addresses`)

    const accountsFrontiers = await rpc(
      {
        action: 'accountsFrontiers',
        accounts: addresses
      },
      {
        url: argv.rcp2
      }
    )

    const hashes = Object.values(accountsFrontiers.frontiers)
    const blocksInfo = await rpc(
      {
        action: 'blocksInfo',
        hashes
      },
      {
        url: argv.rpc2
      }
    )

    const frontiers = Object.values(blocksInfo.blocks)

    for (const account in accounts) {
      const frontier = frontiers.find((b) => b.block_account === account)
      if (!frontier) {
        differences.push({
          account,
          ...accounts[account]
        })
        logger(`${account} - ${accounts[account].block_count}`)
        continue
      }

      if (
        parseInt(frontier.height, 10) !==
        parseInt(accounts[account].block_count, 10)
      ) {
        differences.push({
          account,
          ...accounts[account]
        })
        logger(`${account} - ${accounts[account].block_count}`)
      }
    }

    if (argv.end && accounts[argv.end]) {
      break
    }
  } while (addressCount === batchSize)

  if (!differences.length) {
    logger('no differences found')
    return
  }

  logger(`found ${differences.length} accounts with different frontiers`)
  logger(differences)
  await fs.writeJson('./frontier-differences.json', differences, { spaces: 2 })
}

const main = async () => {
  try {
    await run()
  } catch (err) {
    if (differences.length) {
      console.log('saving differences before exiting')
      fs.writeJsonSync('./frontier-differences.json', differences, {
        spaces: 2
      })
    }
    console.log(err)
  }
  process.exit()
}

if (isMain(import.meta.url)) {
  main()
}

export default run
