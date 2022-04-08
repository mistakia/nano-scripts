import fetch from 'node-fetch'

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

export const rpcRequest = (data, { url = 'http://localhost:7076' } = {}) => {
  return { url, ...POST(data) }
}

export const unchecked_keys = async ({ key, count = 1000, url }) => {
  const data = {
    action: 'unchecked_keys',
    json_block: true,
    count
  }

  if (key) data.key = key

  const options = rpcRequest(data, { url })
  return request(options)
}
