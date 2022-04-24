import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import csvWriter from 'csv-write-stream'
import fs from 'fs'
import rpc from 'nano-rpc'

const writer = csvWriter()
const LIMIT = 1000
const argv = yargs(hideBin(process.argv)).argv

const run = async () => {
  const url = argv.url

  writer.pipe(fs.createWriteStream('./unchecked_blocks.csv'))

  let length
  let key
  do {
    const res = await rpc({
      action: 'unchecked_keys',
      key,
      url,
      count: LIMIT,
      json_block: true
    })

    // push all but first to csv
    const blocks = res.unchecked.slice(1)
    for (const block of blocks) {
      const data = { key: block.key, hash: block.hash, ...block.contents }
      writer.write(data)
    }

    length = res.unchecked.length
    key = res.unchecked[res.unchecked.length - 1].key
  } while (length === LIMIT)

  writer.end()
}

const main = async () => {
  let error
  try {
    await run()
  } catch (err) {
    error = err
    console.log(error)
  }
  process.exit()
}

main()
