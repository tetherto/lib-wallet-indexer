const { EventEmitter } = require('events')
const { randomBytes } = require('crypto')
const fastify = require("fastify")
const { WebSocketServer }  = require('ws')

const rpcSchema = {
  "$id": "jsonrpc",
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "RPC Request",
  "type": "object",
  "properties": {
    "jsonrpc": {
      "type": "string",
      "enum": ["2.0"]
    },
    "method": {
      "type": "string",
      enum :[]
    },
    "params": {
      "type": "array",
      "items": {}
    },
    "id": {
      "type": ["integer", "string", "null"]
    }
  },
  "required": ["jsonrpc", "method", "id"]
}

const rpcErrors = {
  notfound  : {"code": -32601, "message": "Method not found"} 
}


class Websocket extends EventEmitter {

  constructor(config){
    super()
    this.port =  config.port || 8181
    this.ws = new WebSocketServer({
      port:this.port,
    });

    this.ws.on('connection',(ws) =>  {
      ws.on('error', console.error);

      const cid = randomBytes(16).toString('hex')
      ws.on('message', (data) =>  {
        const rpc = this._parseMsg(ws, data, cid)
        if(rpc.error) return ws.send({ error: 'bad request forma'})
        this._processMsg(ws,rpc,cid)
      });

      ws.on('close', () => {
        this.emit('ws-close',{ cid })
      })
    });
  }

  _processMsg(ws, rpc) {

    this.emit(`ws-${rpc.method}`, {
      method: rpc.method,
      params:rpc.params,
      cid: rpc.cid,
      send: (evname, data) =>  {
        ws.send(JSON.stringify({
          error: false,
          event: evname || 'unk',
          data
        }))
      },
      error: (error) => {
        ws.send(JSON.stringify({ error, }))
      }
    })

  }

  _parseMsg(ws, data, cid) {

    let res 

    try {
      res = JSON.parse(data.toString())
    } catch(err) {
      return { error: 'bad request format' }
    }

    return {
      ws,
      method : res.method,
      params: res.params,
      cid 
    }
  }
}

class ProxyServer {
  constructor(config = {}) {
    this.port = config.port || 8008
    this.host = config.host || 'localhost'
    this.currencyName = config.currencyName || 'unk'
    this.fastify = fastify()

    this._rpcSchema = rpcSchema
    this._handlers = new Map()
    this._setupWs(config)
  }

  _setupWs(config) {
    this.ws = new Websocket({
      port : config.wsport,
    })
    const methods = [this._wsSubscribeAccount]
    if(methods.indexOf(undefined) !== -1 ) throw new Error('Not all websocket methods have been  implemented')
    this.ws.on('ws-subscribeAccount',(req) =>{
      this._wsSubscribeAccount(req)
    })
    this.ws.on('ws-close', (cid) => {
      this._wsCloseCid(cid)
    })

    console.log(`Listening websocket port: ${this.ws.port}`)

  }

  start() {
    return new Promise((res, rej) => {
      this._registerBaseRoutes()
      this.fastify.addSchema(this._rpcSchema)
      this.fastify.listen({
        host: this.host,
        port : this.port
      }, (err, addr) =>{
          if(err) return rej(err)
          console.log('Listening', addr)
          res()
        })
    })
  }

  stop(){
    return this.fastify.close()
  }

  _registerBaseRoutes() {
    this.fastify.post('/ping',{ }, this._ping.bind(this))
    this.fastify.post('/jsonrpc',{ }, this._jsonrpc.bind(this))
  }

  _addMethod(opts){
    const methods = this._rpcSchema.properties.method.enum
    if(!opts.method || methods.includes(opts.method)) throw new Error('invalid method')
    methods.push(opts.method)
    if(!opts.handler) throw new Error('handler is missing')
    this._handlers.set(opts.method, opts.handler)
  }

  _ping(req, reply){
    reply.send(this._result(req.body.id, ['pong']))
  }

  _jsonrpc(req, reply){
    const method = req.body.method
    const fn = this._handlers.get(method)
    if(!fn) return reply.send(this._error(req.body.id, 'notfound'))
    fn(req,reply)
  }


  _error(id,msg) {

    let error = rpcErrors[msg]
    if(!error) error = msg

    return {
      jsonrpc: '2.0',
      id : id || null,
      error,
    }

  }

  _result(id, result) {
    return JSON.stringify({
      "jsonrpc": "2.0",
       result : result,
      id
    })
  }

}

module.exports = ProxyServer
