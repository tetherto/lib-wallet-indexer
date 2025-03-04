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
const { Connection, PublicKey } = require('@solana/web3.js')
const { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } = require('@solana/spl-token')

const EVENTS = {
  SUB_ACCOUNT: 'subscribeAccount'
}

class Solana extends Generic {
  constructor (config = {}) {
    super(config)

    this.client = new Connection(config.solana_api ?? 'https://api.mainnet-beta.solana.com')
  }

  async _getHeight () {
    const height = await this.client.getSlot()
    return height
  }

  /**
   * Retrieve transactions for a specific address.
   *
   * @param {Object} req - Request object with query parameters.
   * @param {Object} reply - Reply object for sending the response.
   */
  async _getTransactionsByAddress (req, reply) {
    const id = req.body.id
    const query = req.body.param.pop()
    const addr = query.address

    // TODO: add support for pagination
    const signatures = await this.client.getSignaturesForAddress(new PublicKey(addr), { limit: 100 })

    // Iterate over all associated token accounts for all registered tokens
    for (const token of this._getTokens()) {
      try {
        const ata = await getAssociatedTokenAddress(new PublicKey(token), new PublicKey(addr))
        // TODO: add support for pagination
        const sigs = await this.client.getSignaturesForAddress(ata, { limit: 100 })
        signatures.push(...sigs)
      } catch (err) {
        console.log(err)
        continue
      }
    }
    const txs = await Promise.all(signatures.map(tx => this.client.getParsedTransaction(tx.signature)))
    const ret = await Promise.all(txs.map(tx => this._parseTx(tx, tx?.slot)))

    reply.send(this._result(id, ret.flat()))
  }

  async _parseTx (tx, height) {
    const transaction = tx?.transaction
    const meta = tx?.meta

    // ignore failed transactions
    if (tx?.err || meta?.err || meta?.status?.Ok !== null) return []
    if (!transaction?.signatures?.[0]) return []
    if (!meta?.postBalances) return []
    if (!meta?.preBalances) return []

    // First signature is always the transaction ID
    const hash = transaction.signatures[0]
    const solTxs = meta.postBalances.map((postBalance, index) => {
      const preBalance = meta.preBalances[index]
      if (preBalance === undefined) return null

      const diff = (new BN(postBalance)).minus(preBalance)
      // Diff lower than 0 means it's not a deposit
      if (diff.lte(0)) return null

      const to = transaction?.message?.accountKeys?.[index]?.pubkey?.toString()
      if (!to) return null

      return {
        hash,
        // From address cannot be determined from the pre/post balance changes
        // from: null,
        to,
        value: diff,
        blockNumber: height
      }
    }).filter(Boolean)

    const tokens = this._getTokens()
    if (tokens.size === 0) {
      return solTxs
    }

    const ret = solTxs.concat(this._processTokenBalances(tx, tokens, hash, height))
    return ret
  }

  _processTokenBalances (tx, tokens, hash, height) {
    const postTokenBalances = tx?.meta?.postTokenBalances?.filter(({ mint }) => tokens.has(mint)) ?? []
    const preTokenBalances = tx?.meta?.preTokenBalances?.filter(({ mint }) => tokens.has(mint)) ?? []

    // Process transactions with type "transfer"
    const txTransfers = postTokenBalances
      .filter(Boolean)
      // Calculate token transfer differences. (Receiver will have positive bfx_amount, sender will have negative)
      // NOTE: post/pre token balance array is not in order, you must rely on accountIndex
      .map(transfer => {
        const addrIndex = transfer.accountIndex
        const preBal = preTokenBalances.filter(({ accountIndex }) => accountIndex === addrIndex).pop()
        const to = tx.transaction.message?.accountKeys?.[transfer.accountIndex]?.pubkey?.toString()
        if (!to) {
          return { amount: '0' }
        }

        let preBalAmount = preBal?.uiTokenAmount?.amount
        if (preBalAmount === undefined) {
          // This checks if a transaction both creates ATA and makes a transfer.
          // In this case we can assume the preTokenBalance is zero.
          if (this._hasCreateATAInstruction(tx, to)) {
            preBalAmount = 0
          } else {
            return { amount: '0' }
          }
        }

        const amount = (new BN(transfer.uiTokenAmount.amount)).minus(preBalAmount)
        return {
          blockNumber: height,
          hash,
          to,
          value: amount.toString(),
          token: transfer.mint
        }
      })
      .filter(t => +t.value > 0)
      // We find the sender via comparing amounts and the reciever's address
      .map(transfer => {
        const sender = tx?.transaction?.message?.instructions?.filter(({ parsed }) => {
          const amount = parsed?.info?.tokenAmount?.amount || parsed?.info?.amount
          const destination = parsed?.info?.destination
          return amount === transfer.value && destination === transfer.to && parsed.type !== 'transferChecked'
        }).pop()

        if (!sender) {
          // If the sender is not found in the parsed info, then it must be a transferCheck transaction
          return null
        }
        transfer.from = sender?.parsed?.info?.source
        return transfer
      }).filter(Boolean)

    // Process transactions with type "transferChecked"
    const instructions = tx?.transaction?.message?.instructions ?? []
    const txTransfersChecks = instructions.filter(({ parsed }) => {
      if (!parsed) return false
      if (parsed.type !== 'transferChecked') return false
      return tokens.has(parsed.info.mint)
    }).map(({ parsed }) => {
      return {
        blockNumber: height,
        hash,
        from: parsed.info.source,
        to: parsed.info.destination,
        value: parsed.info.tokenAmount.amount,
        token: parsed.info.mint
      }
    })

    return txTransfers.concat(txTransfersChecks)
  }

  async _getAddrSetsForComparison (tx, addr) {
    try {
      const addresses = [addr]
      if (tx.token) {
        const ata = await getAssociatedTokenAddress(new PublicKey(tx.token), new PublicKey(addr))
        addresses.push(ata.toString())
      }

      const addrSet = new Set(addresses)
      const normalizedAddrSet = new Set(addresses.map(a => this._normalizeAddress(a)))

      return { addrSet, normalizedAddrSet }
    } catch (err) {
      console.error(err)
      return { addrSet: new Set(), normalizedAddrSet: new Set() }
    }
  }

  _hasCreateATAInstruction (tx, ataAddress) {
    const found = tx?.transaction?.message?.instructions?.find(i => {
      return ASSOCIATED_TOKEN_PROGRAM_ID.equals(i.programId) &&
        i.parsed.info.account === ataAddress &&
        ['createIdempotent', 'create'].includes(i.parsed.type)
    })

    return !!found
  }

  async _getHeightTxs (height) {
    const block = await this.client.getBlock(height, {
      maxSupportedTransactionVersion: 0,
      rewards: false
    })
    const txPromises = block?.transactions.map(tx => this._parseTx(tx, height)) ?? []
    const ret = await Promise.all(txPromises)

    return ret
  }

  _getTokens () {
    const subs = this._getEventSubs(EVENTS.SUB_ACCOUNT)
    const v = subs.flatMap(sub => sub.event.flatMap(([addr, tokens]) => tokens))
    const tokens = new Set(v)
    return tokens
  }

  // Process contract event and send data to client
  _emitContractEvent (contract, decoded, log) {
    // TODO: not implemented
    return
  }

  // Listen to token  events, and send message to user when detected relevant tx
  async _subToContract (contract) {
    // TODO: not implemented
    return
  }
}

module.exports = Solana
