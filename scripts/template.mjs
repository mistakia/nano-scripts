import debug from 'debug'
// import yargs from 'yargs'
// import { hideBin } from 'yargs/helpers'

import { isMain } from '#common'

// const argv = yargs(hideBin(process.argv)).argv
// const log = debug('template')
debug.enable('template')

const run = async () => {}
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

if (isMain) {
  main()
}

export default run
