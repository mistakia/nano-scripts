import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = fileURLToPath(import.meta.url)
export const resultsPath = path.join(__dirname, '..', '..', 'results')
export const isMain = () => process.argv[1] === fileURLToPath(import.meta.url)
