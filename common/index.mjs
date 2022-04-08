import { fileURLToPath } from 'url'

import * as constants from './constants.mjs'
import * as rpc from './rpc.mjs'

export const isMain = () => process.argv[1] === fileURLToPath(import.meta.url)

export { rpc, constants }
