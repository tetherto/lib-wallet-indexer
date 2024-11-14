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

const { TronWeb } = require('tronweb')
const _ = require('lodash')
const BaseServer = require('./proxy')

const TRANSFER_METHOD = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

const EVENTS = {
  SUB_ACCOUNT: 'subscribeAccount'
}

class Tron extends BaseServer {
  #clearEmptySubIntervalRef
  #queryBlockIntervalRef
  #lastProcessedBlock

  constructor (config = {}) {
    super(config)
    this.config = config

    if (!config.tron_solidity_api || !config.tron_api) {
      console.log('tron_solidity_api and tron_api values are mandatory in config')
      process.exit(1)
    }

    const tronArgs = {
      solidityNode: config.tron_solidity_api
    }

    if (config.tron_api_key) {
      tronArgs.fullHost = config.tron_api
      tronArgs.headers = { 'X-API-Key': config.tron_api_key }
    } else {
      tronArgs.fullNode = config.tron_api
    }

    const tronweb = new TronWeb(tronArgs)
    this.tronweb = tronweb

    this._subs = new Map()
    this._contractSubs = new Set()
    this.#lastProcessedBlock = 0
    this._MAX_SUB_SIZE = 10000
  }

  async start () {
    this._addMethod({
      method: 'status',
      handler: this.#_apiStatus.bind(this)
    })

    this._addMethod({
      method: 'getTransactionsByAddress',
      handler: this.#getTransactionsByAddress.bind(this)
    })

    await super.start()

    /**
    * @description periodically check for zero value subs and remove them from map
    */
    this.#clearEmptySubIntervalRef = setInterval(() => {
      for (const [k, v] of this._subs) {
        if (v === 0) this._subs.delete(k)
      }
    }, 5000)

    /**
    * @description AVG Tron block generation time is 3s, so have to perform a lookup more often than that
    */
    this.#queryBlockIntervalRef = setInterval(() => {
      this.#subNewBlock()
    }, this.config.tron_block_read_interval_ms || 2000)
  }

  /**
  * @description stops indexer adn clears all intervals
  */
  async stop () {
    await super.stop()
    clearInterval(this.#clearEmptySubIntervalRef)
    clearInterval(this.#queryBlockIntervalRef)
    delete this.tronweb
  }

  /**
  * @description returns latest block height
  */
  async #_apiStatus (req, reply) {
    const { id } = req.body
    try {
      const block = await this.tronweb.trx.getCurrentBlock()
      const height = block?.block_header?.raw_data?.number
      if (!height) throw new Error('api status call fail')

      reply.send(this._result(id, { blockHeader: height }, null))
    } catch (err) {
      console.log('api status cal err: ', err)
      reply.send(this._error(id, 'failed to get status'))
    }
  }

  /**
  * @description Get new blocks and filter transactions
  */
  async #subNewBlock () {
    try {
      const subs = this._getEventSubs(EVENTS.SUB_ACCOUNT)
      if (!(subs || []).length) return // no subscribers to broadcast events to

      const currBlock = await this.tronweb.trx.getCurrentBlock()
      const height = currBlock?.block_header?.raw_data?.number
      if (!height) throw new Error('failed getting latest height')
      if (height === this.#lastProcessedBlock) return

      const txs = currBlock?.transactions
      if (!(txs || []).length) return

      this.#processTxs({ height, txs })
      this.#processContractTxs(txs)
      this.#lastProcessedBlock = height
    } catch (err) {
      console.log('Error getting new block: ', err)
    }
  }

  /**
  * @description processes regular transactions and broadcasts messages to appropriate subscribers
  */
  #processTxs ({ height, txs }) {
    const subs = this._getEventSubs(EVENTS.SUB_ACCOUNT)
    txs
      .map(tx => this.#parseTx(tx))
      .filter(Boolean)
      .map(tx => ({ ...tx, height }))
      .forEach(tx => {
        subs.forEach((sub) => {
          sub.event?.forEach(([addr]) => {
            if (![tx.from.toLowerCase(), tx.to.toLowerCase()].includes(addr.toLowerCase())) return
            sub.send(EVENTS.SUB_ACCOUNT, { tx, addr })
          })
        })
      })
  }

  /**
  * @description processes smart contract transactions and broadcasts messages to appropriate subscribers
  */
  #processContractTxs (txs) {
    txs
      .filter(tx => this.#isContractTx(tx))
      .map(async tx => {
        try {
          const txInfo = await this.tronweb.trx.getTransactionInfo(tx.txID)
          return txInfo
        } catch (err) {
          console.log('failed getting transaction info: ', err)
          return null
        }
      })
      .filter(Boolean)
      .filter(tx => this.#isValidContractTx(tx))
      .forEach(tx => this._emitContractEvent(tx))
  }

  /**
   * @description process contract event and send data to appropriate subscribers
   **/
  _emitContractEvent (tx) {
    const subs = this._getEventSubs(EVENTS.SUB_ACCOUNT)
    const log = _.get(tx, 'log[0]')
    const topics = log.topics
    const amount = parseInt(log.data, 16)

    const toAddress = TronWeb.address.fromHex(`0x${topics[2].substr(24, topics[2].length)}`)
    const fromAddress = TronWeb.address.fromHex(`0x${topics[1].substr(24, topics[1].length)}`)

    subs.forEach(sub => {
      sub.event?.forEach(([addr, tokens]) => {
        if (!tokens.includes(TronWeb.address.fromHex(tx.contract_address))) return
        if (![toAddress.toLowerCase(), fromAddress.toLowerCase()].includes(addr.toLowerCase())) return

        sub.send(EVENTS.SUB_ACCOUNT, {
          addr,
          token: TronWeb.address.fromHex(tx.contract_address),
          tx: {
            height: tx.blockNumber,
            txid: tx.id,
            from: fromAddress,
            to: toAddress,
            value: amount,
            fee: tx.fee,
            receipt: tx.receipt
          }
        })
      })
    })
  }

  /**
   * @description checks if it's a smart contract transactions
   **/
  #isContractTx (tx) {
    const contractRet = _.get(tx, 'ret[0].contractRet')
    if (contractRet !== 'SUCCESS') {
      return false
    }

    const contract = _.get(tx, 'raw_data.contract[0]')
    if (_.get(contract, 'type') !== 'TriggerSmartContract') {
      return false
    }

    const contractAddr = TronWeb.address.fromHex(_.get(contract, 'parameter.value.contract_address'))
    if (!this._contractSubs.has(contractAddr)) {
      return false
    }

    return true
  }

  /**
   * @description checks if it's a valid smart contract transactions
   **/
  #isValidContractTx (tx) {
    if (tx.result === 'FAILED') {
      return false
    }

    if (_.get(tx, 'receipt.result') !== 'SUCCESS') {
      return false
    }

    if (!_.isArray(_.get(tx, 'log'))) {
      return false
    }

    if (_.get(tx, 'log.length') > 1) {
      return false
    }

    const log = tx.log[0]
    const topics = log.topics

    if (topics[0] !== TRANSFER_METHOD) {
      return false
    }

    return true
  }

  /**
   * @description parses raw transaction data and returns mandatory fields
   **/
  #parseTx (tx) {
    const contractRet = _.get(tx, 'ret[0].contractRet')
    if (contractRet !== 'SUCCESS') return null

    if (!tx.raw_data || !tx.raw_data.contract) return null

    let contract = tx.raw_data.contract
    if (!contract.length) return null

    contract = contract[0]
    if (contract.type !== 'TransferContract') return null

    const param = contract.parameter
    if (param.type_url !== 'type.googleapis.com/protocol.TransferContract') {
      return null
    }

    if (+param.value?.amount < 0) return null

    if (!param.value?.owner_address || !param.value?.to_address) return null

    const fromAddress = TronWeb.address.fromHex(param.value.owner_address)
    const toAddress = TronWeb.address.fromHex(param.value.to_address)

    return {
      txid: tx.txID,
      value: param.value.amount,
      to: toAddress,
      from: fromAddress,
      timestamp: tx.raw_data.timestamp
    }
  }

  _subscribeToLogs (contracts) {
    if (this._contractSubs.size === 50) {
      console.log('maximum number of contracts subscribed')
      return
    }
    contracts.forEach((addr) => {
      this._contractSubs.add(addr)
    })
  }

  /**
   * @description get's block transactions by height and returns parsed representation of these transactions
   **/
  async #getBlockTransactions (ix) {
    try {
      const block = await this.tronweb.trx.getBlockByNumber(ix)
      const txs = block?.transactions
      if (!(txs || []).length) return []

      return txs
        .map(tx => this.#parseTx(tx))
        .filter(Boolean)
        .map(tx => ({ ...tx, height: ix }))
    } catch (err) {
      console.log(`Failed to fetch block ${ix}:`, err)
      return []
    }
  }

  /**
   * Retrieves transactions for a specific address within a block range.
   *
   * @param {Object} req - Request object with query parameters.
   * @param {Object} reply - Reply object for sending the response.
   * @description
   * Searches for transactions involving a given address within specified blocks.
   * Collects transactions where the address is sender or recipient, up to a maximum count.
   * Uses tronweb for blockchain interaction.
   */
  async #getTransactionsByAddress (req, reply) {
    const query = req.body.param.pop()
    const id = req.body.id
    const maxRecords = query.pageSize || 100
    let { fromBlock, toBlock } = query

    if (!toBlock) {
      try {
        const block = await this.tronweb.trx.getCurrentBlock()
        toBlock = block?.block_header?.raw_data?.number
      } catch (err) {}
    }

    if (!toBlock) return reply.send(this._error(id, 'latest block is missing'))
    if (!fromBlock) {
      fromBlock = toBlock - 10 // setting some reasonable defaults
    }

    // sanity check
    if (fromBlock > toBlock) {
      return reply.send(this._error(id, 'toBlock must be higher than fromBlock'))
    }

    const blockNumbers = Array.from(
      { length: toBlock - fromBlock + 1 },
      (_, i) => fromBlock + i
    )

    const txs = await Promise.all(blockNumbers.map(bn => this.#getBlockTransactions(bn)))
    const filteredTxs = txs
      .flat()
      .filter(tx => [tx.from.toLowerCase(), tx.to.toLowerCase()].includes(query.address.toLowerCase()))
      .slice(0, maxRecords)

    return reply.send(this._result(id, filteredTxs))
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
    const account = req?.params[0]
    const evName = EVENTS.SUB_ACCOUNT
    if (!account) return req.error(evName, 'account not sent')

    const tokens = req?.params[1] || []
    if (this._subs.size >= this._MAX_SUB_SIZE) {
      console.log('reached max number of subscriptions')
      return req.error(evName, 'server is not available')
    }

    const cidSubs = this._getCidSubs(req.cid, evName) || []

    const acctExists = cidSubs.filter((sub) => sub[0] === account).length > 0
    if (acctExists) return req.error(evName, 'already subscribed to address')

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

module.exports = Tron
