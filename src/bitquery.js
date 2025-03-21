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
class BitqueryClient {
  constructor(config) {
    this.endpoint = "https://graphql.bitquery.io";
    this.headers = new Headers();

    if (!config.bitquery_api_key) {
      throw new Error("bitquery client missing bitquery_api_key")
    }

    if (!config.bitquery_auth_token) {
      throw new Error("bitquery client missing bitquery_auth_token")
    }

    this.headers.append("Content-Type", "application/json");
    this.headers.append("Authorization", `Bearer ${config.bitquery_auth_token}`);
    this.headers.append("X-API-KEY", config.bitquery_api_key);
  }

  getTransfersQuery (signatures) {
    const signatureFilter = signatures && signatures.length > 0 
      ? 'signature: {in: $signatures},' 
      : '';
  
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
    `;
  };
  

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
    signatures = signatures.filter((item, index) => signatures.indexOf(item) === index);
    const variables = JSON.stringify({ limit, offset, addresses, signatures, instructionType });
    const body = JSON.stringify({ query, variables });
    const requestOptions = { method: "POST", headers: this.headers, body, };

    try {
      const response = await fetch(this.endpoint, requestOptions);
      if (!response.ok) {
        throw new Error(`Network error: ${response.status} - ${response.statusText}`);
      }

      const result = await response.json();

      if (result.errors) {
        console.error(result.errors)
        throw new Error("Bad request error");
      }

      return result.data.solana;
    } catch (error) {
      console.error("Error fetching transfers:", error);
      throw error;
    }
  }
}

module.exports = BitqueryClient
