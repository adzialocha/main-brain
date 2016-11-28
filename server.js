const connect = require('connect')
const serveStatic = require('serve-static')
const ws = require('ws')
const fs = require('fs')
const osc = require('osc-min')
const dgram = require('dgram')

const HTTP_SERVER_PORT = 8080
const HTTP_STATIC_FOLDER = 'view'

const SCORE_PATH = 'score.json'

const UDP_SERVER_PORT = 41234
const UDP_SEND_PORT = 7500
const UDP_SEND_ADDRESS = '127.0.0.1'

const CHANNEL_IN = 'in'
const CHANNEL_OUT = 'out'
const SYSTEM_ADDRESS_ROOT = 'brain'

const ANALYSE_ACTIVITY_FREQUENCY = 20
const UPDATE_DENSITY_FREQUENCY = 5000
const ACTIVITY_TRESHOLD = 0.1

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

class Participant {
  constructor(id) {
    this.id = id
    this.lastMessage = null

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

const participants = {}

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

  checkPossibleNodes(density)

  clear()
}

// score

let score
let node

function enterNode(name) {
  if (score.nodes[name] && !!score.nodes[name].connections) {
    node = score.nodes[name]
    node.connections = node.connections.sort((a, b) => {
      return a.treshold - b.treshold
    })
    broadcast([SYSTEM_ADDRESS_ROOT, 'node'], name)
  } else {
    throw new Error(`Cant find a valid node "${name}" in score.`)
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

// messaging

function broadcast(address, value) {
  const args = [ value ]
  const message = osc.toBuffer(address.join('/'), args)

  udpSocket.send(message, 0, message.length, UDP_SEND_PORT, UDP_SEND_ADDRESS, (error) => {
    if (error) {
      console.log(error)
    }
  })
}

// http server

connect().use(serveStatic([__dirname, HTTP_STATIC_FOLDER].join('/'))).listen(HTTP_SERVER_PORT);

// udp socket

udpSocket = dgram.createSocket('udp4')

udpSocket.on('error', (err) => {
  console.log(err)
})

udpSocket.on('message', (buffer) => {
  const data = osc.fromBuffer(buffer)
  const address = data.address.split('/')

  if (address.length === 4 && data.args.length === 1 && address[1] === CHANNEL_IN) {
    const [id, channel, param, type] = address
    const value = data.args[0].value

    try {
      participants[id][channel][param][type].push(value)
      participants[id].out[param][type] = value

      participants[id].lastMessage = new Date()

      broadcast([id, CHANNEL_OUT, param, type], value)
    } catch(error) {
      console.log(error.message)
    }
  }
})

udpSocket.bind(UDP_SERVER_PORT)

// read score

fs.readFile(SCORE_PATH, 'utf8', (error, data) => {
  if (error) throw error
  score = JSON.parse(data)

  if (score && score.name && score.nodes && score.start) {
    enterNode(score.start)
  } else {
    console.log('No valid score read or found.');
  }
})

// create participants

participants.sam = new Participant('sam')
participants.andreas = new Participant('andreas')

// start update session

setInterval(update, UPDATE_DENSITY_FREQUENCY)
setInterval(analyse, ANALYSE_ACTIVITY_FREQUENCY)
