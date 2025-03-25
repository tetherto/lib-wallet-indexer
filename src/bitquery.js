// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License")
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
const { WebSocket } = require("ws")
const mockSubData = require('../test/fixtures/solana-sub-response.json')

'use strict'
class BitqueryClient {
  constructor(config) {
    this.endpoint = "https://graphql.bitquery.io"
    this.headers = new Headers()

    if (!config.bitquery_api_key) {
      throw new Error("bitquery client missing bitquery_api_key")
    }

    if (!config.bitquery_auth_token) {
      throw new Error("bitquery client missing bitquery_auth_token")
    }

    this.headers.append("Content-Type", "application/json")
    this.headers.append("Authorization", `Bearer ${config.bitquery_auth_token}`)
    this.headers.append("X-API-KEY", config.bitquery_api_key)
  }

  getTransfersQuery(signatures) {
    const signatureFilter = signatures && signatures.length > 0
      ? 'signature: {in: $signatures},'
      : ''

    return `
      query ($addresses: [String!], ${signatures && signatures.length > 0 ? '$signatures: [String!],' : ''} $instructionType: String!, $limit: Int!, $offset: Int!) {
        solana {
          asReceiver: transfers(
            receiverAddress: {in: $addresses}
            ${signatureFilter}
            options: {desc: "block.height", limit: $limit, offset: $offset}
            parsedType: {is: $instructionType}
          ) {
            block { height }
            receiver { address }
            sender { address }
            amount
            currency { symbol address decimals }
            instruction { action { type } }
            transaction { signature }
          }
          asSender: transfers(
            senderAddress: {in: $addresses}
            ${signatureFilter}
            options: {desc: "block.height", limit: $limit, offset: $offset}
            parsedType: {is: $instructionType}
          ) {
            block { height }
            receiver { address }
            sender { address }
            amount
            currency { symbol address decimals }
            instruction { action { type } }
            transaction { signature }
          }
        }
      }
    `
  }


  /**
   * Fetch transfer data for the given addresses and signatures.
   *
   * @param {string[]} address - An array of addresses.
   * @param {string[]} signatures - An array of signatures.
   * @param {number} [limit=99999] - The limit for the number of records.
   * @param {number} [offset=0] - The offset for pagination.
   * @returns {Promise<Object>} - The response data from Bitquery.
   */
  async getTransfers(addresses, signatures, instructionType = "transfer", limit = 99999, offset = 0) {
    if (addresses.length === 0) {
      throw new Error('No addresses passed')
    }

    const query = this.getTransfersQuery(signatures)
    // Filter out duplicates
    signatures = signatures.filter((item, index) => signatures.indexOf(item) === index)
    const variables = JSON.stringify({ limit, offset, addresses, signatures, instructionType })
    const body = JSON.stringify({ query, variables })
    const requestOptions = { method: "POST", headers: this.headers, body, }

    try {
      const response = await fetch(this.endpoint, requestOptions)
      if (!response.ok) {
        throw new Error(`Network error: ${response.status} - ${response.statusText}`)
      }

      const result = await response.json()

      if (result.errors) {
        console.error(result.errors)
        throw new Error("Bad request error")
      }

      return result.data.solana
    } catch (error) {
      console.error("Error fetching transfers:", error)
      throw error
    }
  }
}

class BitqueryWebSocket {
  static tokenTransferQuery = `
  subscription ($mintaddress: [String!]) {
    Solana {
      Transfers(where: {Transfer: {Currency: {MintAddress: {in: $mintaddress}}}}) {
        Transfer {
          Currency {
            Symbol
            Decimals
            MintAddress
          }
          Receiver {
            Address
            Owner
          }
          Sender {
            Address
            Owner
          }
          Amount
        }
        Transaction {
          Signature
        }
        Block {
          Height
          Slot
        }
      }
    }
  }
  `
  constructor(config) {
    this.mintAddresses =  []
    this.activeMintAddresses = []
    this.uri = `wss://streaming.bitquery.io/eap?token=${config.bitquery_auth_token}`
    this.ws = null
  }


  // connect(cb) {
  //   this.activeMintAddresses = this.mintAddresses

  //   const { Transfers } = mockSubData.Solana

  //   cb(Transfers)
  // }

  // Open the websocket connection and setup event listeners
  connect(cb) {
    if (this.mintAddresses.length === 0) {
      console.log("Connection cancelled, please add mintAddresses")
      return
    }

    this.ws = new WebSocket(this.uri, ["graphql-ws"])

    this.ws.on("open", () => {
      console.log("Connected to Bitquery.")
      const initMessage = JSON.stringify({ type: "connection_init" })
      this.ws.send(initMessage)
    })

    this.ws.on("message", (data) => {
      const response = JSON.parse(data)

      if (response.type === "connection_ack") {
        console.log("Connection acknowledged by server.")
        this.sendSubscription()
      }

      if (response.type === "data") {
        console.log("Received new data")
        const { Transfers } = response.payload.data.Solana
        cb(Transfers)
      }

      if (response.type === "ka") {
        console.log("Keep-alive message received.")
      }

      if (response.type === "error") {
        console.error("Error message received:", response.payload.errors)
      }
    })

    this.ws.on("close", () => {
      console.log("Disconnected from Bitquery.")
      this.activeMintAddresses = []
    })

    this.ws.on("error", (error) => {
      if (error.message !== 'WebSocket was closed before the connection was established') {
        console.error("WebSocket Error:", error)
      }
    })
  }

  // Sends the subscription message using the stored query and variables
  sendSubscription() {
    const subscriptionMessage = JSON.stringify({
      type: "start",
      id: "1",
      payload: {
        query: BitqueryWebSocket.tokenTransferQuery,
        variables: {
          mintaddress: this.mintAddresses
        }
      }
    })
    this.ws.send(subscriptionMessage)
    console.log("Subscription message sent.")
    this.activeMintAddresses = this.mintAddresses
  }

  /**
   * Update the mintAddresses list (ensuring uniqueness) and reconnect only if there's a change.
   * @param {string | Array<string>} addresses - A mint address or an array of mint addresses.
   */
  addMintAddresses(addresses) {
    const addressesToUpdate = Array.isArray(addresses) ? addresses : [addresses]
    const uniqueSet = new Set([...this.mintAddresses, ...addressesToUpdate])
    const updatedMintAddresses = Array.from(uniqueSet)

    const oldSet = new Set(this.mintAddresses)
    const isSame = (oldSet.size === uniqueSet.size) &&
      [...oldSet].every(addr => uniqueSet.has(addr))

    if (isSame) {
      // console.log("No changes to mint addresses.")
      return
    }

    this.mintAddresses = updatedMintAddresses
    // console.log("Updated mint addresses:", this.mintAddresses)
  }

  // Close the current websocket connection
  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.activeMintAddresses = []
      console.log("WebSocket connection closed.")
    }
  }

  /**
   * Resubscribe to mint addresses.
   */
  resubscribeToTranferEvents(cb, contractAddresses) {
    if (this.activeMintAddresses.length > 0) {
      const newSet = new Set(contractAddresses);
      const currentSet = new Set(this.activeMintAddresses);
      const isSame = newSet.size === currentSet.size && [...newSet].every(addr => currentSet.has(addr));
      if (isSame) {
        console.log("Passed mint addresses are the same as current. Cancelling reconnection.");
        return;
      }
    }

    this.disconnect()

    console.log("Resubscribing to mint addresses: ", this.mintAddresses)

    this.connect(cb)
  }
}

module.exports = { BitqueryClient, BitqueryWebSocket }
