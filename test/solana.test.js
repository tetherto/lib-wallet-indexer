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
const Solana = require('../src/solana')
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

test('solana indexer methods', async t => {
  const methods = [
    {
      method: 'status',
      params: [],
      expected: (t, res) => {
        t.ok(res.height >= 0, 'expected block header')
      }
    },
    {
      method: 'getTransactionsByAddress',
      params: [{ address: 'GL4ZXgPJauJhhL6EMkRr349vHexe4LABoX4wtHYv5pt3', fromBlock: 365076092, toBlock: 365076092 }],
      expected: (t, res) => {
        const tx = res[0]
        t.ok(res.length === 1, 'returns single tx for given block range')
        t.ok(typeof tx.value === "string", 'value is string')
        t.ok(tx.blockNumber === 365076092, 'timestamp is integer')
        t.ok(typeof tx.hash === 'string' && tx.hash.length > 0, 'txid is present')
      }
    }
  ]

  t.test('methods', async t => {
    const solana = new Solana(config)
    await solana.start()

    await Promise.all(methods.map(async (m) => {
      t.comment(`testing method:  ${m.method}`)
      const res = await callServer(m.method, m.params)
      m.expected(t, res.result)
    }))
    await solana.stop()
    t.pass('stopped server')
  })
})

test('Solana class initialization', async (t) => {
  const solana = new Solana(config)

  t.ok(solana instanceof Solana, 'solana should be an instance of Solana')
  t.alike(solana.config, config, 'solana.config should match the provided config')
  t.ok(solana._subs instanceof Map, 'solana._subs should be a Map')
  await solana.stop()
  t.pass()
})

test('solana _getEventSubs method', async (t) => {
  const solana = new Solana(config)
  const eventName = 'testEvent'

  solana._subs.set('sub1', { [eventName]: ['event1'], send: () => {} })
  solana._subs.set('sub2', { [eventName]: ['event2'], send: () => {} })
  solana._subs.set('sub3', { unsupported: ['event3'], send: () => {} })

  const subs = solana._getEventSubs(eventName)

  t.ok(subs.length === 2, 'Should return 2 subscriptions')
  t.ok(Array.isArray(subs[0].event), 'Subscription event should be an array')
  t.ok(typeof subs[0].send === 'function', 'Subscription should have a send function')
  await solana.stop()
})

test('solana _addSub method', async (t) => {
  const solana = new Solana(config)

  function sendCb () {}
  function errorCb () {}
  const subData = {
    send: sendCb,
    error: errorCb,
    evName: 'testEvent',
    param: ['param1', 'param2'],
    cid: 'testCid'
  }

  solana._addSub(subData)

  const addedSub = solana._subs.get('testCid')
  t.ok(addedSub.send === sendCb, 'added sub should have correct send function')
  t.ok(addedSub.error, errorCb, 'added sub should have correct error function')
  t.ok(addedSub.testEvent === subData.param, 'added sub should have correct event parameters')
  await solana.stop()
})
