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
const BN = require('bignumber.js')
const Generic = require('./generic')
const solanaWeb3 = require('@solana/web3.js')

const EVENTS = {
  SUB_ACCOUNT: 'subscribeAccount'
}

class Solana extends Generic {
  constructor (config = {}) {
    super(config)

    this._disableHeightProcessing = true

    this.client = new solanaWeb3.Connection(config.provider ?? 'https://api.mainnet-beta.solana.com')
  }

  async _getHeight () {
    const height = await this.client.getSlot()
    return height
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
    const id = req.body.id
    const query = req.body.param.pop()
    const addr = query.address

    // TODO: add support for pagination
    const signatures = await this.client.getSignaturesForAddress(new solanaWeb3.PublicKey(addr), { limit: 100 })
    const txs = await Promise.all(signatures.map(tx => this.client.getTransaction(tx.signature)))
    const ret = await Promise.all(txs.map(tx => this._parseTx(tx, tx?.slot)))

    reply.send(this._result(id, ret.flat()))
  }

  async _parseTx (tx, height) {
    const transaction = tx?.transaction
    const meta = tx?.meta

    // ignore failed transactions
    if (meta?.err) return []
    if (!meta?.postBalances) return []
    if (!meta?.preBalances) return []

    return meta.postBalances.map((postBalance, index) => {
      const preBalance = meta.preBalances[index]
      if (preBalance === undefined) return null

      const diff = (new BN(postBalance)).minus(preBalance)
      // Diff lower than 0 means it's not a deposit
      if (diff.lte(0)) return null

      const to = transaction?.message?.accountKeys?.[index]?.toString()
      if (!to) return null
      if (!transaction?.signatures?.[0]) return null

      return {
        // First signature is always the transaction ID
        hash: transaction.signatures[0],
        // From address cannot be determined from the pre/post balance changes
        // from: null,
        to,
        value: diff,
        blockNumber: height
      }
    }).filter(Boolean)
  }
}

module.exports = Solana
