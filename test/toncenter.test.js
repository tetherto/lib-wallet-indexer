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

'use strict'
const { test } = require('brittle')
const assert = require('assert')
const { TonWeb } = require('tonweb')
const Toncenter = require('../src/toncenter')
const config = require('../config.json')
const spec = require('./spec.json')

test('Toncenter class initialization', async (t) => {
  const toncenter = new Toncenter(config)

  assert(toncenter instanceof Toncenter, 'toncenter should be an instance of Toncenter')
  assert.strictEqual(toncenter.config, config, 'toncenter.config should match the provided config')
  assert(toncenter._subs instanceof Map, 'toncenter._subs should be a Map')
  assert(Array.isArray(toncenter._contractLogSubs), 'toncenter._contractLogSubs should be an array')
  assert.strictEqual(toncenter._MAX_SUB_SIZE, 10000, 'toncenter._MAX_SUB_SIZE should be 10000')
  await toncenter.stop()
  t.pass()
})

test('Toncenter start method', async (t) => {
  const toncenter = new Toncenter(config)

  // Mock the necessary methods to avoid actual network calls
  toncenter._addRoutes = () => {}
  toncenter._subNewBlock = async () => {}

  await toncenter.start()

  assert(toncenter._subs instanceof Map, 'toncenter._subs should still be a Map after start')
  t.pass()
  await toncenter.stop()
})

test('Toncenter methods', async (t) => {
  t.plan(13)

  const toncenter = new Toncenter(config)
  await toncenter.start()

  const req = {
    body: {
      id: 'test'
    }
  }

  const res = {
    send: function (data) {
      const res = JSON.parse(data)
      this.test(res)
    }
  }

  toncenter._apiStatus(req, {
    ...res,
    test: function (res) {
      console.log(res)
      t.ok(res.id === "test", 'invalid api status')
    }
  })

  req.body.param = [{
    address: 'UQAqxtYFXRbVRjo1GQbGVtJCoifxIRPWeiCa_rTf93uxuBtz'
  }]

  await toncenter._getTransactionsByAddress(req, {
    ...res,
    test: function (res) {
      const result = res.result
      const tx = result[0]
      t.ok(result.length > 0, 'returns many transactions')
      t.ok(Number.isInteger(tx.value), 'value is integer')
      t.ok(Number.isInteger(tx.blockNumber), 'blockNumber is integer')
    }
  })

  req.body.param = [{
    address: 'UQAqxtYFXRbVRjo1GQbGVtJCoifxIRPWeiCa_rTf93uxuBtz',
    jettonMaster: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
  }]

  await toncenter._getTokenTransfers(req, {
    ...res,
    test: function (res) {
      const result = res.result
      const tokenTransfer = result[0]
      t.ok(result.length > 0, 'returns many token transfers')
      t.ok(Number.isInteger(tokenTransfer.value), 'value is integer')
    }
  })

  req.body.param = [{
    jettonMaster: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
  }]

  await toncenter._getAllTokenTransfers(req, {
    ...res,
    test: function (res) {
      const result = res.result
      const tokenTransfer = result[0]
      t.ok(result.length > 0, 'returns many token transfers')
      t.ok(Number.isInteger(tokenTransfer.value), 'value is integer')
    }
  })

  await toncenter._wsSubscribeAccount({
    ...req,
    params: [
      'UQAqxtYFXRbVRjo1GQbGVtJCoifxIRPWeiCa_rTf93uxuBtz',
      ['EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs']
    ],
    send: function (ev, data) {
      t.ok(ev === 'subscribeAccount', 'event name is correct')
      console.log(data)
      t.ok(data.addr === 'UQAqxtYFXRbVRjo1GQbGVtJCoifxIRPWeiCa_rTf93uxuBtz', 'addr is correct')
      t.ok(data.token === 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', 'token is correct')
    }
  })

  await toncenter._wsSubscribeAccount({
    ...req,
    params: [
      'UQCl65pBKVl2yZ9DaIL3uavPhWITgYGne1P6r0CPzXw_7XD-',
      ['EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs']
    ],
    send: function (ev, data) {
      t.ok(ev === 'subscribeAccount', 'event name is correct')
      t.ok(data.addr === 'UQCl65pBKVl2yZ9DaIL3uavPhWITgYGne1P6r0CPzXw_7XD', 'addr is correct')
      t.ok(data.token === 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', 'token is correct')
    }
  })
})
