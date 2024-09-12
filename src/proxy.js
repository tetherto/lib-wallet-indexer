const fastify = require('fastify')
const cors = require('@fastify/cors')
const Websocket = require('./ws')

const rpcSchema = {
  $id: 'jsonrpc',
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'RPC Request',
  type: 'object',
  properties: {
    jsonrpc: {
      type: 'string',
      enum: ['2.0']
    },
    method: {
      type: 'string',
      enum: []
    },
    params: {
      type: 'array',
      items: {}
    },
    id: {
      type: ['integer', 'string', 'null']
    }
  },
  required: ['jsonrpc', 'method', 'id']
}

const rpcErrors = {
  notfound: { code: -32601, message: 'Method not found' }
}



class ProxyServer {
  constructor (config = {}) {
    this.port = config.rpc_port || 8008
    this.host = config.rpc_host || 'localhost'
    this.currencyName = config.currencyName || 'unk'
    this.fastify = fastify()

    this._rpcSchema = rpcSchema
    this._handlers = new Map()
    this._setupWs(config)
  }

  _setupWs (config) {
    this.ws = new Websocket(config)
    const methods = [this._wsSubscribeAccount]
    if (methods.indexOf(undefined) !== -1) throw new Error('Not all websocket methods have been  implemented')
    this.ws.on('ws-subscribeAccount', (req) => {
      this._wsSubscribeAccount(req)
    })
    this.ws.on('ws-close', (cid) => {
      this._wsCloseCid(cid)
    })

    console.log(`Listening Websocket: localhost:${this.ws.port}`)
  }

  start () {
    return new Promise((resolve, reject) => {
      this._registerBaseRoutes()
      this.fastify.addSchema(this._rpcSchema)
      this.fastify.register(cors,{})
      this.fastify.listen({
        host: this.host,
        port: this.port
      }, (err, addr) => {
        if (err) return reject(err)
        console.log('Listening JSON-RPC: ', addr)
        resolve()
      })
    })
  }

  stop () {
    return this.fastify.close()
  }

  _registerBaseRoutes () {
    this.fastify.post('/ping', { }, this._ping.bind(this))
    this.fastify.post('/jsonrpc', { }, this._jsonrpc.bind(this))
  }

  _addMethod (opts) {
    const methods = this._rpcSchema.properties.method.enum
    if (!opts.method || methods.includes(opts.method)) throw new Error('invalid method')
    methods.push(opts.method)
    if (!opts.handler) throw new Error('handler is missing')
    this._handlers.set(opts.method, opts.handler)
  }

  _ping (req, reply) {
    reply.send(this._result(req.body.id, ['pong']))
  }

  _jsonrpc (req, reply) {
    const method = req.body.method
    const fn = this._handlers.get(method)
    if (!fn) return reply.send(this._error(req.body.id, 'notfound'))
    fn(req, reply)
  }

  _error (id, msg) {
    let error = rpcErrors[msg]
    if (!error) error = msg

    return {
      jsonrpc: '2.0',
      id: id || null,
      error
    }
  }

  _result (id, result) {
    return JSON.stringify({
      jsonrpc: '2.0',
      result,
      id
    })
  }
}

module.exports = ProxyServer
