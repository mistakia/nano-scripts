import { fileURLToPath } from 'url'

import * as constants from './constants.mjs'

export const isMain = () => process.argv[1] === fileURLToPath(import.meta.url)

export { constants }
