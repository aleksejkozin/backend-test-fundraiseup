const http = require('http')
const https = require('https')

class TimeoutError extends Error {
  constructor(message = 'Timeout') {
    super(message)
  }
}

class HTTPError extends Error {
  constructor(message, statusCode) {
    super(message)
    this.statusCode = statusCode
  }
}

/**
 * Promise-based wrapper for the http(s).request
 * @param {http.RequestOptions | string | http.URL} options - The options for the request.
 * @param {*} [data] - The data to send.
 * @returns {Promise<Buffer>} - The response.
 */
const request = (options, data) =>
  new Promise((resolve, reject) => {
    const req = (options.protocol === 'http:' ? http : https).request(
      options,
      (res) => {
        const body = []
        res.on('data', (chunk) => body.push(chunk))
        res.on('error', reject)
        res.on('end', () => {
          try {
            const response = Buffer.concat(body)
            if (res.statusCode === 200) {
              resolve(response)
            } else {
              reject(new HTTPError(response.toString(), res.statusCode))
            }
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new TimeoutError()))
    if (data) req.write(data)
    req.end()
  })

const statistics = {
  requests: 0,
  success: 0,
  errors500: 0,
  errorsTimeout: 0,
}

/**
 * Sends PingData to Statistics Server.
 * Will retry failed attempts with exponential backoff. Will also update local statistics.
 * @param {PingData} ping
 * @returns {void}
 */
const sendPingToStatisticsServer = (ping) => {
  const pingStr = JSON.stringify(ping)

  console.log(`Sending ping:`, pingStr)
  statistics.requests++

  request(
    {
      timeout: 10_000,
      protocol: 'http:',
      hostname: 'localhost',
      port: 8080,
      path: '/data',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    },
    pingStr
  )
    .then((response) => {
      console.log(`Response for pingId ${ping.pingId}:`, response.toString())
      statistics.success++
    })
    .catch((e) => {
      console.error(`Error sending pingId ${ping.pingId}:`, e.message)
      if (e instanceof HTTPError && e.statusCode === 500) {
        statistics.errors500++
      } else if (e instanceof TimeoutError) {
        statistics.errorsTimeout++
      }

      setTimeout(
        () =>
          sendPingToStatisticsServer({
            ...ping,
            deliveryAttempt: ping.deliveryAttempt + 1,
          }),
        1000 * (2 ^ ping.deliveryAttempt)
      )
    })
}

let pingId = 1

/**
 * Calculates HTTP response time in milliseconds.
 * @param {string} url
 * @returns {Promise<number>} - The response time in milliseconds.
 */
const responseTime = async (url) => {
  const start = Date.now()
  await request(url)
  return Date.now() - start
}

setInterval(
  () =>
    responseTime('https://fundraiseup.com/').then((responseTime) =>
      sendPingToStatisticsServer({
        pingId: pingId++,
        date: Date.now(),
        deliveryAttempt: 1,
        responseTime,
      })
    ),
  1000
)

// On process exit print statistics
process.on('SIGINT', () => process.exit(0))
process.on('exit', () => console.log('Client ping statistics:', statistics))
