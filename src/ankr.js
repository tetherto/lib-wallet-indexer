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
const BaseServer = require('./proxy')
const { Web3, FMT_NUMBER } = require('web3')
const { AnkrProvider } = require('@ankr.com/ankr.js')

const EVENTS = {
  SUB_ACCOUNT: 'subscribeAccount'
}

const TOPIC_SIG = Web3.utils.sha3('Transfer(address,address,uint256)')

class Ankr extends BaseServer {
  constructor (config = {}) {
    super(config)
    this.config = config
    this.web3 = new Web3(config.web3 || 'ws://localhost:8545')
    this.web3.defaultReturnFormat = {
      number: FMT_NUMBER.NUMBER
    }
    this._subs = new Map()
    this._contractLogSubs = []
    this._MAX_SUB_SIZE = 10000
    this._ankr = new AnkrProvider(config.ankr)
    this.chain = config.chain
  }

  async start () {
    this._addRoutes()
    await super.start()
    await this._subNewBlock()
    const currentBlock = await this.web3.eth.getBlockNumber()
    if (currentBlock <= 0) throw new Error('remote node is not ready')

    /**
    * @description Loop through all subs and if the value is set to zero, remove from array
    */
    this._subTimer = setInterval(() => {
      for (const [k, v] of this._subs) {
        if (v === 0) this._subs.delete(k)
      }
    }, 5000)
  }

  async stop () {
    const web3 = this.web3
    await super.stop()
    clearInterval(this._subTimer)
    web3.currentProvider.disconnect()
    web3.currentProvider.removeAllListeners()
  }

  _addRoutes () {
    this._addMethod({
      method: 'status',
      handler: this._apiStatus.bind(this)
    })

    this._addMethod({
      method: 'getTransactionsByAddress',
      handler: this._getTransactionsByAddress.bind(this)
    })
  }

  async _apiStatus (req, reply) {
    try {
      const block = await this.web3.eth.getBlockNumber()
      reply.send(this._result(req.body.id, {
        blockHeader: block
      }, null))
    } catch (err) {
      console.log(err)
      reply.send(this._error(req.body.id, 'failed to get status'))
    }
  }

  /**
  * @description Listen to Web3 new block event and filter transactions
  */
  async _subNewBlock () {
    const web3 = this.web3
    const blockSub = await web3.eth.subscribe('newHeads')
    blockSub.on('data', async blockhead => {
      const filter = this._getEventSubs(EVENTS.SUB_ACCOUNT)
      try {
        const block = await web3.eth.getBlock(blockhead.number, true)
        if (!block) return
        for (const tx of block.transactions) {
          this._filterBlockTx(tx, filter, EVENTS.SUB_ACCOUNT)
        }
      } catch (err) {
        console.log('failed to get block tx', err)
      }
    })
    blockSub.on('error', error =>
      console.log('Error when subscribing to New block header: ', error)
    )
  }

  _subscribeToLogs (contracts) {
    if (this._contractLogSubs.length === 50) return console.log('maximum number of contracts subscribed')
    contracts.forEach((addr) => {
      if (this._contractLogSubs.includes(addr)) return
      this._subToContract(addr)
    })
  }

  /**
   * @description process contract event and send data to client
   **/
  _emitContractEvent (contract, decoded, log) {
    const filter = this._getEventSubs(EVENTS.SUB_ACCOUNT)
    filter.forEach((sub) => {
      sub.event.forEach(([addr, tokens]) => {
        if (!tokens.includes(contract.toLowerCase())) return
        if (decoded.from.toLowerCase() !== addr && decoded.to.toLowerCase() !== addr) return

        sub.send(EVENTS.SUB_ACCOUNT, {
          addr,
          token: contract,
          tx: {
            height: log.blockNumber,
            txid: log.transactionHash,
            from: decoded.from,
            to: decoded.to,
            value: decoded.value && decoded.value.toString()
          }
        })
      })
    })
  }

  /**
   * @description Listen to token  events, and send message to user when detected relevant tx
  **/
  async _subToContract (contract) {
    const web3 = this.web3
    contract = contract.toLowerCase()
    const sub = await web3.eth.subscribe('logs', {
      address: contract,
      topics: [TOPIC_SIG]
    })

    sub.on('data', (log) => {
      let decoded
      try {
        decoded = web3.eth.abi.decodeLog(
          [
            { type: 'address', name: 'from', indexed: true },
            { type: 'address', name: 'to', indexed: true },
            { type: 'uint256', name: 'value' }
          ],
          log.data,
          log.topics.slice(1)
        )
      } catch (err) {
        console.log('Failed to decode event', log)
        return
      }
      this._emitEvent(contract, decoded, log)
    })
    sub.on('error', error =>
      console.log('Error when subscribing to contract: ', contract, error)
    )
  }

  /**
  * @description Filter transactions in block and send websocket msg
  * @param {String} txid transaction id
  * @param {EventSub}
  * @param {string} evName event name
  * @emits evName
  */
  async _filterBlockTx (tx, filter, evName) {
    try {
      filter.forEach((sub) => {
        sub.event.forEach(([addr]) => {
          if (!(tx.from === addr || tx.to === addr)) return true
          sub.send(evName, {
            tx, addr
          })
        })
      })
    } catch (err) {
      console.log('Failed to filter block tx', err)
    }
  }

  /**
   * Retrieves transactions for a specific Ethereum address within a block range.
   *
   * @param {Object} req - Request object with query parameters.
   * @param {Object} reply - Reply object for sending the response.
   * @description
   * Searches for transactions involving a given address within specified blocks.
   * Collects transactions where the address is sender or recipient, up to a maximum count.
   * Uses Web3.js for blockchain interaction.
   */
  async _getTransactionsByAddress (req, reply) {
    const eth = this.web3.eth
    const query = req.body.param.pop()
    const id = req.body.id
    const pageSize = query.pageSize || 101
    const fromBlock = query.fromBlock || 0
    const toBlock = query.toBlock || Number(await eth.getBlockNumber())
    const addr = query.address
    let res
    try {
      res = await this._ankr.getTransactionsByAddress({
        blockchain: this.chain,
        fromBlock,
        toBlock,
        address: [addr],
        pageSize,
        descOrder: true
      })
    } catch (err) {
      console.log(err)
      return reply.send(this._error(id, 'failed to get tx history'))
    }
    const fmt = res.transactions.map((e) => {
      e.value = Number.parseInt(e.value || 0)
      e.gas = Number.parseInt(e.gas)
      e.gasUsed = Number.parseInt(e.gasUsed)
      e.timestamp = Number.parseInt(e.timestamp)
      e.gasPrice = Number.parseInt(e.gasPrice)
      return e
    })
    reply.send(this._result(id, fmt))
  }

  /**
  * @description check if an address is a smart contract or account
  * @param {String} addr eth address
  * @returns {Promise<Boolean>}
  */
  async _isAccount (addr) {
    let res
    try {
      res = await this.web3.eth.getCode(addr)
    } catch (err) {
      return false
    }
    return res === '0x'
  }

  /**
 * @description Filters and maps event subscriptions for a given event name.
 * @param {string} evName - The name of the event to filter subscriptions for.
 * @returns {Array<{event: any, send: Function}>} An array of filtered and mapped subscriptions.
 */
  _getEventSubs (evName) {
    return Array.from(this._subs.values())
      .filter(con => con[evName])
      .map(con => ({ event: con[evName], send: con.send }))
  }

  /**
  * @description subscribe to account and tokens for a user
  **/
  async _wsSubscribeAccount (req) {
    let account = req?.params[0]
    let tokens = req?.params[1] || []
    const evName = EVENTS.SUB_ACCOUNT
    if (this._subs.size >= this._MAX_SUB_SIZE) {
      console.log('reached max number of subscriptions')
      return req.error('server is not available')
    }
    if (!await this._isAccount(account)) {
      return req.error('not an eth account')
    }
    if (await this._isAccount(tokens)) {
      return req.error('not an eth contract')
    }
    account = account.toLowerCase()
    tokens = tokens.map((str) => str.toLowerCase())
    if (!account) return req.error('account not sent')
    let cidSubs = this._getCidSubs(req.cid, evName)
    if (!cidSubs) {
      cidSubs = []
    }
    cidSubs.push([account, tokens])

    this._subscribeToLogs(tokens)
    console.log(`New sub: acct: ${account} - tokens ${tokens}`)

    this._addSub({
      send: req.send,
      error: req.error,
      evName,
      param: cidSubs,
      cid: req.cid
    })
  }

  _getCidSubs (cid, evName) {
    const userSubs = this._subs.get(cid)
    if (!userSubs) return null
    return userSubs[evName] || null
  }

  _addSub (data) {
    let userSubs = this._subs.get(data.cid)
    if (userSubs === 0) return
    if (!userSubs) {
      userSubs = {}
      userSubs.send = data.send
      userSubs.error = data.error
    }
    userSubs[data.evName] = data.param
    this._subs.set(data.cid, userSubs)
  }

  _wsCloseCid (opts) {
    this._subs.set(opts.cid, 0)
  }
}

module.exports = Ankr
