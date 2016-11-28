const connect = require('connect')
const serveStatic = require('serve-static')
const fs = require('fs')
const osc = require('osc-min')
const dgram = require('dgram')

const HTTP_SERVER_PORT = 8080
const HTTP_STATIC_FOLDER = 'view'

const SCORE_PATH = 'score.json'

const UDP_SERVER_PORT = 41234
const UDP_CLIENT_PORT = 7400

const CHANNEL_IN = 'in'
const CHANNEL_OUT = 'out'
const SYSTEM_ADDRESS_ROOT = 'brain'

const ANALYSE_ACTIVITY_FREQUENCY = 20
const UPDATE_DENSITY_FREQUENCY = 5000
const ACTIVITY_TRESHOLD = 0.1

const PARTICIPANT_NAMES = [
  'sam',
  'andreas',
]

// helpers

function log(message) {
  console.log(message)
}

function average(values) {
  let sum = 0

  if (values.length === 0) {
    return sum
  }

  values.forEach((value) => {
    sum += value
  })

  return sum / values.length
}

// participants

class Participant {
  constructor(id) {
    this.id = id

    this.lastMessage = null

    this.port = null
    this.address = null

    this.in = {
      volume: {
        pre: [],
        post: [],
      }
    }

    this.out = {
      volume: {
        pre: 0,
        post: 0,
      }
    }
  }

  clearBuffer() {
    this.in.volume.pre = []
    this.in.volume.post = []
  }

  analyse() {
    const post = average(this.in.volume.post)
    this.clearBuffer()
    return post
  }
}

let participants = {}

function registerParticipants(names) {
  participants = {}

  names.forEach((name) => {
    participants[name] = new Participant(name)
  })
}

// density analysis

let activity = 0

function clear() {
  activity = 0
}

function analyse() {
  Object.keys(participants).forEach((id) => {
    if (participants[id].analyse() >= ACTIVITY_TRESHOLD) {
      activity += 1
    }
  })
}

function update() {
  const max = (UPDATE_DENSITY_FREQUENCY / ANALYSE_ACTIVITY_FREQUENCY) * Object.keys(participants).length
  const density = (activity / max) > max ? 1.0 : activity / max

  broadcast([SYSTEM_ADDRESS_ROOT, 'density'], density)

  if (density > 0) {
    log(`Set densitiy to ${density}`)
  }

  checkPossibleNodes(density)

  clear()
}

// score

let timeout
let score
let node

function startTrigger(frequency) {
  stopTrigger()

  timeout = setTimeout(() => {
    startTrigger(frequency)
    broadcast([SYSTEM_ADDRESS_ROOT, 'trigger'])
  }, frequency)
}

function stopTrigger() {
  if (timeout) {
    clearTimeout(timeout)
    timeout = null
  }
}

function enterNode(name) {
  if (score.nodes[name] && !!score.nodes[name].connections) {
    node = score.nodes[name]
    node.connections = node.connections.sort((a, b) => {
      return a.treshold - b.treshold
    })

    if (node.frequency) {
      startTrigger(node.frequency)
    } else {
      stopTrigger()
    }

    log(`Enter node "${name}"`)

    broadcast([SYSTEM_ADDRESS_ROOT, 'node'], name)

  } else {
    throw new Error(`Cant find a valid node "${name}" in score`)
  }
}

function checkPossibleNodes(density) {
  if (! node) {
    return false
  }

  node.connections.some((connection) => {
    if (connection.treshold < density) {
      enterNode(connection.node)
      return false
    }

    return true
  })
}

function reset() {
  clear()

  // read score

  fs.readFile(SCORE_PATH, 'utf8', (error, data) => {
    if (error) throw error
    score = JSON.parse(data)

    if (score && score.name && score.nodes && score.start) {
      log(`Load score "${score.name}" with ${Object.keys(score.nodes).length} nodes`)
      enterNode(score.start)
    } else {
      log('No valid score read or found')
    }
  })

  // participants

  registerParticipants(PARTICIPANT_NAMES)
}

// messaging

function broadcast(address, value) {
  const args = value !== undefined ? [ value ] : []
  const message = osc.toBuffer(address.join('/'), args)

  Object.keys(participants).forEach((key) => {
    const { address } = participants[key]
    if (address) {
      udpSocket.send(message, 0, message.length, UDP_CLIENT_PORT, address, (error) => {
        if (error) { log(error) }
      })
    }
  })
}

// http server

connect().use(serveStatic([__dirname, HTTP_STATIC_FOLDER].join('/'))).listen(HTTP_SERVER_PORT);

// udp socket

udpSocket = dgram.createSocket('udp4')

udpSocket.on('listening', () => {
  const address = udpSocket.address()
  log(`UDP server listening on ${address.address}:${address.port}`)
})

udpSocket.on('error', (err) => {
  log(err.message)
})

udpSocket.on('message', (buffer, info) => {
  const data = osc.fromBuffer(buffer)
  const address = data.address.split('/')

  if (address.length > 1) {
    const id = address[0]

    if (id in participants && !participants[id].port) {
      participants[id].port = info.port
      participants[id].address = info.address
      log(`Found participant "${id}" at ${info.address}:${info.port}. Use port ${UDP_CLIENT_PORT} for listening`)
    }
  }

  if (address.length === 4 && data.args.length === 1 && address[1] === CHANNEL_IN) {
    const [id, channel, param, type] = address
    const value = data.args[0].value

    try {
      participants[id][channel][param][type].push(value)
      participants[id].out[param][type] = value

      participants[id].lastMessage = new Date()

      broadcast([id, CHANNEL_OUT, param, type], value)
    } catch(error) {
      log(error.message)
    }

  } else if (address.length === 2 && address[0] === SYSTEM_ADDRESS_ROOT) {
    if (address[1] === 'reset') {
      reset()
    }
  }
})

udpSocket.bind(UDP_SERVER_PORT)

// print info

log(`HTTP server listening on ${HTTP_SERVER_PORT}`)

// reset

reset()

// start update session

setInterval(update, UPDATE_DENSITY_FREQUENCY)
setInterval(analyse, ANALYSE_ACTIVITY_FREQUENCY)
