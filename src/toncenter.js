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
const TonUtils = TonWeb.utils

const PAGINATION_LIMIT = 250

class TonCenter extends Generic {
  constructor (config = {}) {
    super(config)

    this._indexerUri = config?.indexerUri ?? 'https://toncenter.com/api/v3'
    this._indexerApiKey = config?.indexerApiKey ?? ''
  }

  async _callIndexer (method, params = {}) {
    const headers = { Accept: 'application/json' }
    if (this._indexerApiKey) {
      headers['X-API-Key'] = this._indexerApiKey
    }

    const response = await fetch(`${this._indexerUri}/${method}?${querystring.stringify(params)}`, {
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
      from: this._normalizeAddress(from),
      to: this._normalizeAddress(to),
      value: tx.in_msg.value,
      blockNumber: height
    }
  }

  _normalizeTxHash (hash) {
    // Convert from base64Url to base64
    return hash
      .replace(/-/g, '+')
      .replace(/_/g, '/')
  }

  _normalizeAddress (address) {
    return new TonUtils.Address(address).toString(true, true, true)
  }

  /**
   * Retrieves transactions for a specific address.
   * @param {Object} req - Request object with query parameters.
   * @param {Object} reply - Reply object for sending the response.
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
}

module.exports = TonCenter
