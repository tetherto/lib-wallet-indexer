// Copyright 2025 Tether Operations Limited
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

const test = require('brittle')
const fetch = require('node-fetch')
const Tron = require('../src/tron')
const config = require('../config.json')
const spec = require('./spec.json')

async function callServer (method, param, path) {
  const response = await fetch(spec.indexer_uri + (path || 'jsonrpc'), {
    method: 'post',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      param,
      id: (Math.random() * 10e10).toFixed(0)
    })
  })
  return response.json()
}

test('tron indexer methods', async t => {
  const methods = [
    {
      method: 'status',
      params: [],
      expected: (t, res) => {
        t.ok(res.blockHeader >= 0, 'expected block header')
      }
    },
    {
      method: 'getTransactionsByAddress',
      params: [{ address: 'TCatzc8KCvckHZFEF7JrkJDi6gru5xJ8NG', fromBlock: 65740840, toBlock: 65740840 }],
      expected: (t, res) => {
        const tx = res[0]
        t.ok(res.length === 1, 'returns single tx for given block range')
        t.ok(Number.isInteger(tx.value), 'value is integer')
        t.ok(Number.isInteger(tx.timestamp), 'timestamp is integer')
        t.ok(tx.height === 65740840, 'timestamp is integer')
        t.ok(typeof tx.txid === 'string' && tx.txid.length > 0, 'txid is presenmt')
      }
    }
  ]

  t.test('methods', async t => {
    const tron = new Tron(config)
    await tron.start()

    await Promise.all(methods.map(async (m) => {
      t.comment(`testing method:  ${m.method}`)
      const res = await callServer(m.method, m.params)
      m.expected(t, res.result)
    }))
    await tron.stop()
    t.pass('stopped server')
  })
})

test('Tron class initialization', async (t) => {
  const tron = new Tron(config)

  t.ok(tron instanceof Tron, 'tron should be an instance of Tron')
  t.alike(tron.config, config, 'tron.config should match the provided config')
  t.ok(tron._subs instanceof Map, 'tron._subs should be a Map')
  t.ok(tron._contractSubs instanceof Set, 'tron._contractSubs should be a Set')
  t.ok(tron._MAX_SUB_SIZE === 10000, 'tron._MAX_SUB_SIZE should be 10000')
  await tron.stop()
  t.pass()
})

test('tron _getEventSubs method', async (t) => {
  const tron = new Tron(config)
  const eventName = 'testEvent'

  tron._subs.set('sub1', { [eventName]: ['event1'], send: () => {} })
  tron._subs.set('sub2', { [eventName]: ['event2'], send: () => {} })
  tron._subs.set('sub3', { unsupported: ['event3'], send: () => {} })

  const subs = tron._getEventSubs(eventName)

  t.ok(subs.length === 2, 'Should return 2 subscriptions')
  t.ok(Array.isArray(subs[0].event), 'Subscription event should be an array')
  t.ok(typeof subs[0].send === 'function', 'Subscription should have a send function')
  await tron.stop()
})

test('tron _addSub method', async (t) => {
  const tron = new Tron(config)

  function sendCb () {}
  function errorCb () {}
  const subData = {
    send: sendCb,
    error: errorCb,
    evName: 'testEvent',
    param: ['param1', 'param2'],
    cid: 'testCid'
  }

  tron._addSub(subData)

  const addedSub = tron._subs.get('testCid')
  t.ok(addedSub.send === sendCb, 'added sub should have correct send function')
  t.ok(addedSub.error, errorCb, 'added sub should have correct error function')
  t.ok(addedSub.testEvent === subData.param, 'added sub should have correct event parameters')
  await tron.stop()
})

test('tron subscribe account', async (t) => {
  const tron = new Tron(config)
  tron._addMethod = () => {}
  await tron.start()

  await new Promise(resolve => {
    tron._wsSubscribeAccount({
      body: { id: 'test' },
      params: [
        'TSSZG8wWojpog8mBJ2Sunm5r6bDn1PM5KJ',
        ['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t']
      ],
      send: (ev, data) => {
        // capture emited event and validate the data
        t.ok(ev === 'subscribeAccount', 'event name is correct')
        t.ok(data.addr === 'TSSZG8wWojpog8mBJ2Sunm5r6bDn1PM5KJ', 'addr is correct')
        t.ok(data.token === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'token is correct')
        t.ok(data.tx.height === 65475881, 'height is correct')
        t.ok(data.tx.txid === '14f76e7133c08129cdd7bad50e46ef1260ada32aa5e5d3f9f09463eae175dd10', 'tx hash is correct')
        t.ok(data.tx.fee === 13844850, 'fee is correct')
        t.ok(data.tx.value === 5000000, 'base amount is correct (6 dec places)')
        t.ok(data.tx.from === 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', 'sender address is correct')
        t.ok(data.tx.to === 'TSSZG8wWojpog8mBJ2Sunm5r6bDn1PM5KJ', 'recipient address is correct')
        resolve()
      }
    })

    // emit an event
    tron._emitContractEvent({
      id: '14f76e7133c08129cdd7bad50e46ef1260ada32aa5e5d3f9f09463eae175dd10',
      fee: 13844850,
      blockNumber: 65475881,
      blockTimeStamp: 1727075901000,
      contractResult: [
        '0000000000000000000000000000000000000000000000000000000000000000'
      ],
      contract_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
      receipt: {
        energy_fee: 13499850,
        energy_usage_total: 64285,
        net_fee: 345000,
        result: 'SUCCESS',
        energy_penalty_total: 49635
      },
      log: [
        {
          address: 'a614f803b6fd780986a42c78ec9c7f77e6ded13c',
          topics: [
            'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            '000000000000000000000000e96051e8da2f0cc02c372252dfacfdb129b5d4d6',
            '000000000000000000000000b4ae27db126ab459139d0e1f073206b6575b0b17'
          ],
          data: '00000000000000000000000000000000000000000000000000000000004c4b40'
        }
      ]
    })
  })

  await tron.stop()
})
