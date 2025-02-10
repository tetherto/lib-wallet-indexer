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

const EVENTS = {
  SUB_ACCOUNT: 'subscribeAccount'
}

class Generic extends BaseServer {
  constructor (config = {}) {
    super(config)
    this.config = config

    this._subs = new Map()
    this._contractLogSubs = []
    this._MAX_SUB_SIZE = 10000

    this._lastHeight = -1
    this._heightProcessing = false
    this._disableHeightProcessing = false
  }

  async start () {
    this._addRoutes()
    await super.start()
    await this._subNewBlock()
    const height = await this._getHeight()
    this._lastHeight = height

    // Loop through all subs and if the value is set to zero, remove from array
    this._subTimer = setInterval(() => {
      for (const [k, v] of this._subs) {
        if (v === 0) this._subs.delete(k)
      }
    }, 5000)
  }

  async stop () {
    await super.stop()

    if (this._newBlockPoll) {
      clearInterval(this._newBlockPoll)
    }

    clearInterval(this._subTimer)
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

  /**
   * Return current height
   * @returns {Promise<Number>}
   */
  async _getHeight () {
    throw new Error('not implemented')
  }

  /**
   * Return txs for the given height
   * @param {Number} height
   * @returns {Promise<any[]>}
   */
  async _getHeightTxs (height) {
    throw new Error('not implemented')
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
    throw new Error('not implemented')
  }

  async _apiStatus (req, reply) {
    try {
      const height = await this._getHeight()
      reply.send(this._result(req.body.id, { height }))
    } catch (err) {
      console.log(err)
      reply.send(this._error(req.body.id, 'failed to get status'))
    }
  }

  // Poll for new blocks and filter transactions
  async _subNewBlock () {
    if (this._disableHeightProcessing) {
      return
    }

    this._newBlockPoll = setInterval(async () => {
      try {
        await this._processHeight()
      } catch (err) {
        console.error(err)
      }
    }, 5000)
  }

  async _processHeight () {
    if (this._heightProcessing) {
      return
    }

    try {
      this._heightProcessing = true
      const currentHeight = await this._getHeight()
      for (let height = this._lastHeight + 1; height <= currentHeight; height++) {
        console.log(`Processing height ${height}`)

        const subs = this._getEventSubs(EVENTS.SUB_ACCOUNT)
        if (subs.length === 0) {
          // No need to process height if noone is listening
          this._lastHeight = currentHeight
          console.log(`Skipping height processing to ${currentHeight} due to no subscribers`)
          return
        }

        const txs = await this._getHeightTxs(height).catch(err => {
          // Skip this height due to error
          console.trace(`Could not retrieve height ${height}`, err)
          return []
        })

        console.log(`Processing ${txs.length} txs for height ${height}`)
        for (const sub of subs) {
          for (const [addr] of sub.event) {
            for (const tx of txs) {
              const { addrSet, normalizedAddrSet } = await this._getAddrSetsForComparison(tx, addr)
              if (!this._isTxForAddress(tx, addrSet, normalizedAddrSet)) continue
              sub.send(EVENTS.SUB_ACCOUNT, {
                tx,
                addr,
                token: tx.token
              })
            }
          }
        }
        this._lastHeight = height
      }
    } finally {
      this._heightProcessing = false
    }
  }

  /**
   * @param {any} tx
   * @param {string} addr
   */
  async _getAddrSetsForComparison (tx, addr) {
    const addrSet = new Set(addr)
    const normalizedAddrSet = new Set(this._normalizeAddress(addr))
    return { addrSet, normalizedAddrSet }
  }

  /**
   * @param {any} tx
   * @param {Set<string>} address
   * @param {Set<string>} normalizedAddress
   * @returns
   */
  _isTxForAddress (tx, address, normalizedAddress) {
    return normalizedAddress.has(tx.from) || normalizedAddress.has(tx.to)
  }

  /**
   * @param {string} address
   * @returns {string}
   */
  _normalizeAddress (address) {
    return address
  }

  _subscribeToLogs (contracts) {
    if (this._contractLogSubs.length === 50) return console.log('maximum number of contracts subscribed')
    contracts.forEach((addr) => {
      if (this._contractLogSubs.includes(addr)) return
      this._subToContract(addr)
      this._contractLogSubs.push(addr)
    })
  }

  // Listen to token events, and send message to user when detected relevant tx
  async _subToContract (contract) {
    throw new Error('not implemented')
  }

  /**
   * Filters and maps event subscriptions for a given event name.
   * @param {string} evName - The name of the event to filter subscriptions for.
   * @returns {Array<{event: any, send: Function}>} An array of filtered and mapped subscriptions.
   */
  _getEventSubs (evName) {
    return Array.from(this._subs.values())
      .filter(con => con[evName])
      .map(con => ({ event: con[evName], send: con.send }))
  }

  /**
   * Subscribe to address and tokens for a user
   **/
  async _wsSubscribeAccount (req) {
    let address = req?.params[0]
    const tokens = req?.params[1] || []
    const evName = EVENTS.SUB_ACCOUNT
    if (!address) return req.error('account not sent')
    if (this._subs.size >= this._MAX_SUB_SIZE) {
      console.log('reached max number of subscriptions')
      return req.error('server is not available')
    }

    address = this._normalizeAddress(address)
    const cidSubs = this._getCidSubs(req.cid, evName) ?? []

    const acctExists = cidSubs.filter((sub) => sub[0] === address).length > 0
    if (acctExists) return req.error(evName, 'already subscribed to address')

    cidSubs.push([address, tokens])

    this._subscribeToLogs(tokens)
    console.log(`New sub: acct: ${address} - tokens ${tokens}`)

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

module.exports = Generic
