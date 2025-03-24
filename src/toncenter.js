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
const Generic = require('./generic')
const querystring = require('querystring')
/** @type import('tonweb').default */
const TonWeb = require('tonweb')
const { Address } = require('tonweb')
const TonUtils = TonWeb.utils

const PAGINATION_LIMIT = 250

const EVENTS = {
  SUB_ACCOUNT: 'subscribeAccount'
}

class TonCenter extends Generic {
  constructor (config = {}) {
    super(config)

    this._indexerUri = config?.indexerUri ?? 'https://toncenter.com/api/v3'
    this._indexerApiKey = config?.indexerApiKey ?? ''
    this.lastSyncTimestamp = Math.floor(Date.now() / 1000) - 60
    this.activeSubs = {}
  }

  async _callIndexer (method, params = {}) {
    const headers = { Accept: 'application/json' }
    if (this._indexerApiKey) {
      headers['X-API-Key'] = this._indexerApiKey
    }

    const url = `${this._indexerUri}/${method}?${querystring.stringify(params)}`
    const response = await fetch(url, {
      method: 'GET',
      headers
    })
    return response.json()
  }

  async _getHeight () {
    const mc = await this._callIndexer('masterchainInfo')
    return mc?.last?.seqno
  }

  async _getHeightTxs (ix) {
    const txs = await this._paginateIndexerCall(
      'transactionsByMasterchainBlock',
      { seqno: ix },
      res => res?.body?.transactions ?? [],
      txs => Promise.all(txs.map(tx => this._parseTx(tx, ix)))
    )

    return txs.filter(Boolean)
  }

  /**
   * Retrieves all results from a paginated indexer call.
   * @param {string} method
   * @param {object} params
   * @param {function (any): Promise<any[]>} getItemsFn Function receives a response and returns the items to process
   * @param {function (any[]): Promise<any[]>} processFn Function receives items to process and returns processed items
   * @returns
   */
  async _paginateIndexerCall (method, params, getItemsFn, processFn) {
    const ret = []
    const limit = 200
    let offset = 0

    // Limit to PAGINATION_LIMIT*200=50k items to prevent infinite loop
    for (let i = 0; i < PAGINATION_LIMIT; i++) {
      const res = await this._callIndexer(method, {
        ...params,
        limit,
        offset
      })

      const items = await getItemsFn(res)
      
      ret.push(...await processFn(items))

      if (items.length < limit) {
        break
      }
      offset += limit
      if (i === PAGINATION_LIMIT - 1) {
        console.log(`Stopped paging in indexer. Method: ${method}, limit: ${limit}, offset: ${offset}`)
        break
      }
    }

    return ret
  }

  async _parseTx (tx, height) {
    if (tx?.out_msgs?.length !== 0) {
      // It's not a deposit if there's an outgoing message
      // TODO: support outgoing txs
      return
    }

    const hash = tx?.hash
    const from = tx?.in_msg?.source
    const to = tx?.in_msg?.destination

    if (!hash) return
    if (!from) return
    if (!to) return
    if (!tx?.in_msg?.value) return

    return {
      hash: this._normalizeTxHash(hash),
      from: this._normalizeAddress(from, false),
      to: this._normalizeAddress(to, false),
      value: Number(tx.in_msg.value),
      blockNumber: height
    }
  }

  async _parseTokenTransfer (transfer) {
    return {
      hash: this._normalizeTxHash(transfer.transaction_hash),
      from: this._normalizeAddress(transfer.source, false),
      to: this._normalizeAddress(transfer.destination, false),
      value: Number(transfer.amount),
      timestamp: transfer.transaction_now
    }
  }

  _normalizeTxHash (hash) {
    // Convert from base64Url to base64
    return hash
      .replace(/-/g, '+')
      .replace(/_/g, '/')
  }

  _normalizeAddress (address, isContract) {
    return new Address(address).toString({bounceable: isContract, testOnly: false})
  }

  /**
   * Retrieves transactions for a specific Ton address within a block range.
   *
   * @param {Object} req - Request object with query parameters.
   * @param {Object} reply - Reply object for sending the response.
   * @description
   * Searches for transactions involving a given address within specified blocks.
   * Collects transactions where the address is sender or recipient, up to a maximum count.
   */
  async _getTransactionsByAddress (req, reply) {
    const id = req.body.id
    const query = req.body.param.pop()
    const addr = query.address

    const txs = await this._paginateIndexerCall(
      'transactions',
      { account: [addr] },
      res => res?.transactions ?? [],
      txs => Promise.all(txs.map(tx => this._parseTx(tx, tx.mc_block_seqno)))
    )

    reply.send(this._result(id, txs.filter(Boolean)))
  }

  /**
   * Retrieves transactions for a specific Ton address within a block range.
   *
   * @param {Object} req - Request object with query parameters.
   * @param {Object} reply - Reply object for sending the response.
   * @description
   * Searches for transactions involving a given address within specified blocks.
   * Collects transactions where the address is sender or recipient, up to a maximum count.
   */
  async _getTokenTransfers (req, reply) {
    const id = req.body.id
    const query = req.body.param.pop()
    const addr = query.address
    const jettonMaster = query.jettonMaster

    const transfers = await this._paginateIndexerCall(
      'jetton/transfers',
      { owner_address: [addr], jetton_master: jettonMaster },
      res => res?.jetton_transfers ?? [],
      transfers => Promise.all(transfers.map(transfer => this._parseTokenTransfer(transfer, transfer.mc_block_seqno)))
    )

    reply.send(this._result(id, transfers.filter(Boolean)))
  }

  /**
   * Retrieves transactions for a specific Ton address since last timestamp.
   *
   * @param {Object} req - Request object with query parameters.
   * @param {Object} reply - Reply object for sending the response.
   * @description
   * Collects transactions where the token sent is jettonMaster
   */
  async _getAllTokenTransfers (req, reply) {
    const id = req.body.id
    const query = req.body.param.pop()
    const jettonMaster = query.jettonMaster

    const transfers = await this._paginateIndexerCall(
      'jetton/transfers',
      { jetton_master: jettonMaster, start_utime: this.lastSyncTimestamp },
      res => res?.jetton_transfers ?? [],
      transfers => Promise.all(transfers.map(transfer => this._parseTokenTransfer(transfer)))
    )

    reply.send(this._result(id, transfers.filter(Boolean)))
  }

  /**
  * @description subscribe to account and tokens for a user
  **/
  async _wsSubscribeAccount (req) {
    let account = req?.params[0]
    let tokens = req?.params[1] || []
    const evName = EVENTS.SUB_ACCOUNT
    if (!account) return req.error(evName, 'account not sent')
    if (this._subs.size >= this._MAX_SUB_SIZE) {
      console.log('reached max number of subscriptions')
      return req.error(evName, 'server is not available')
    }
    console.log(account)
    if (!await this._isAccount(account)) {
      return req.error(evName, 'not an ton account')
    }
    if (await this._isAccount(tokens)) {
      return req.error(evName, 'not an ton contract')
    }
    account = this._normalizeAddress(account, false)
    tokens = tokens.map((token) => this._normalizeAddress(token, true))
    let cidSubs = this._getCidSubs(req.cid, evName)
    if (!cidSubs) {
      cidSubs = []
    }

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

  /**
   * @description process contract event and send data to client
   **/
  _emitContractEvent (contract, decoded) {
    const filter = this._getEventSubs(EVENTS.SUB_ACCOUNT)
    filter.forEach((sub) => {
      sub.event.forEach(([addr, tokens]) => {
        if (!tokens.includes(contract)) return
        if (this._normalizeAddress(decoded.from) !== addr && this._normalizeAddress(decoded.to) !== addr) return

        sub.send(EVENTS.SUB_ACCOUNT, {
          addr,
          token: contract,
          tx: {
            height: decoded.timestamp,
            hash: decoded.hash,
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
    console.log('New subscription to ', contract)

    const reply = {
      send: function (data) {
        const results = JSON.parse(data)['result']

        results.map(res => this._emitContractEvent(contract, res))
      }.bind(this)
    }

    const intervalMs = 5000;

    // Store the interval ID using the contract address as the key
    this.activeSubs[contract] = setInterval(async () => {
      console.log('Calling _getAllTokenTransfers for', contract);

      const req = {
        body: {
          param: [{
            jettonMaster: new TonUtils.Address(contract).toString()
          }]
        }
      }
      await this._getAllTokenTransfers(req, reply);
    }, intervalMs);
  }
  
  _unsubscribeFromContract (contract) {
    if (this.contractIntervals[contract]) {
      clearInterval(this.contractIntervals[contract]);
      delete this.contractIntervals[contract]; // Remove the entry from the object
      console.log(`Subscription stopped for ${contract}.`);
    } else {
      console.log(`No active subscription found for ${contract}.`);
    }
  }

  /**
  * @description check if an address is a valid ton unbounceable account
  * @param {String} addr ton address
  * @returns {Promise<Boolean>}
  */
  async _isAccount (addr) {
    return TonUtils.Address.isValid(addr)
  }
}

module.exports = TonCenter
