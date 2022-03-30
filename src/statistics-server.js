const http = require('http')
const assert = require('assert')

/**
 * Contains information about response time to a server
 * @typedef {Object} PingData
 * @property {number} pingId
 * @property {number} deliveryAttempt - Number of attempts to deliver the ping.
 * @property {number} date - Timestamp of the ping.
 * @property {number} responseTime - Response time of the ping in milliseconds.
 */

/**
 * statisticsServer can receive PingData from clients and store them in memory for later use
 * @type {PingData[]}
 */
const collectedPings = []

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const body = []
    req.on('data', (chunk) => body.push(chunk))
    req.on('error', reject)
    req.on('timeout', () => req.destroy())
    req.on('end', () => {
      try {
        resolve(Buffer.concat(body))
      } catch (e) {
        reject(e)
      }
    })
  })

/**
 * Accepts PingData as a POST JSON and stores it in collectedPings. Can sometimes fail or hung
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
const onPostData = async (req, res) => {
  assert(req.headers['content-type'] === 'application/json')

  /** @type {PingData} */
  const pingData = JSON.parse((await readBody(req)).toString())
  const assertPositiveNumber = (obj, key) =>
    assert(
      obj && typeof obj[key] === 'number' && obj[key] >= 0,
      `Expected ${key} to be a positive number, got ${obj[key]}`
    )
  assertPositiveNumber(pingData, 'date')
  assertPositiveNumber(pingData, 'pingId')
  assertPositiveNumber(pingData, 'deliveryAttempt')
  assertPositiveNumber(pingData, 'responseTime')

  const OK_CHANCE = 0.6
  const ERROR_CHANCE = 0.2
  const r = Math.random()

  if (r < OK_CHANCE) {
    console.log('Received ping', JSON.stringify(pingData))
    collectedPings.push(pingData)
    res.writeHead(200)
    res.end('OK')
  } else if (r < OK_CHANCE + ERROR_CHANCE) {
    throw new Error('Random internal error')
  } else {
    // In other cases the server will not respond to a client and hung
  }
}

const statisticsServer = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/data') {
      await onPostData(req, res)
    } else {
      res.writeHead(400)
      res.end()
    }
  } catch (e) {
    res.writeHead(500)
    res.end(e.message)
  }
})

const host = 'localhost'
const port = 8080

statisticsServer.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}/`)
})

const arrayStatistics = (array) =>
  array && array.length > 0
    ? {
        length: array.length,
        average: array.reduce((acc, curr) => acc + curr, 0) / array.length,
        median: array.sort((a, b) => a - b)[Math.floor(array.length / 2)],
      }
    : 'No data collected'

// On process exit print statistics
process.on('SIGINT', () => process.exit(0))
process.on('exit', () =>
  console.log(
    'Server ping statistics:',
    arrayStatistics(collectedPings.map((x) => x.responseTime))
  )
)
