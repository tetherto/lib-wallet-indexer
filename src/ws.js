// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'
const { EventEmitter } = require('events')
const { WebSocketServer } = require('ws')
const { randomBytes } = require('crypto')

class Websocket extends EventEmitter {
  /**
  * @param {number} config.port
  **/
  constructor (config) {
    super(config)
    this.port = config.ws_port || 8181
    this.ws = new WebSocketServer({
      port: this.port
    })

    this.ws.on('connection', (ws) => {
      ws.on('error', console.log)

      const cid = randomBytes(16).toString('hex')
      ws.on('message', (data) => {
        const rpc = this._parseMsg(ws, data, cid)
        if (rpc.error) return ws.send(JSON.stringify({ error: 'bad request format' }))
        this._processMsg(ws, rpc, cid)
      })

      ws.on('close', () => {
        this.emit('ws-close', { cid })
      })
    })
  }

  _processMsg (ws, rpc) {
    this.emit(`ws-${rpc.method}`, {
      method: rpc.method,
      params: rpc.params,
      cid: rpc.cid,
      send: (evname, data) => {
        ws.send(JSON.stringify({
          error: false,
          event: evname || 'unk',
          data
        }), (err) => {
          if (err) console.log('sent event failed', err)
        })
      },
      error: (error) => {
        ws.send(JSON.stringify({ error }))
      }
    })
  }

  async stop () {
    return new Promise((resolve, reject) => {
      return this.ws.close(resolve)
    })
  }

  _parseMsg (ws, data, cid) {
    let res

    try {
      res = JSON.parse(data.toString())
    } catch (err) {
      return { error: 'bad request format' }
    }

    return {
      ws,
      method: res.method,
      params: res.params,
      cid
    }
  }
}

module.exports = Websocket
