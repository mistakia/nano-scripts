import fetch from 'node-fetch'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import csvWriter from 'csv-write-stream'
import fs from 'fs'

const writer = csvWriter()

const LIMIT = 1000

const argv = yargs(hideBin(process.argv)).argv

const request = async (options) => {
  const response = await fetch(options.url, options)
  if (response.status >= 200 && response.status < 300) {
    return response.json()
  } else {
    const res = await response.json()
    const error = new Error(res.error || response.statusText)
    error.response = response
    throw error
  }
}

const POST = (data) => ({
  method: 'POST',
  body: JSON.stringify(data),
  headers: {
    'Content-Type': 'application/json'
  }
})

const rpcRequest = (data, { url = 'http://localhost:7076' } = {}) => {
  return { url, ...POST(data) }
}

const getUncheckedKeys = async ({ key, count = LIMIT, url }) => {
  const data = {
    action: 'unchecked_keys',
    json_block: true,
    count
  }

  if (key) data.key = key

  const options = rpcRequest(data, { url })
  return request(options)
}


const run = async () => {
  let url = argv.url

  writer.pipe(fs.createWriteStream('./out.csv'))

  let length
  let key
  do {
    const res = await getUncheckedKeys({ key, url })
    console.log(res)

    // push all but first to csv
    const blocks = res.unchecked.slice(1)
    for (const block of blocks) {
      const data = { key: block.key, hash: block.hash, ...block.contents }
      console.log(data)
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
