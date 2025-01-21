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
const { Web3 } = require('web3')
const Ankr = require('../src/ankr')
const config = require('../config.json')
const spec = require('./spec.json')

test('Ankr class initialization', async (t) => {
  const ankr = new Ankr(config)

  assert(ankr instanceof Ankr, 'ankr should be an instance of Ankr')
  assert(ankr.web3 instanceof Web3, 'ankr.web3 should be an instance of Web3')
  assert.strictEqual(ankr.config, config, 'ankr.config should match the provided config')
  assert(ankr._subs instanceof Map, 'ankr._subs should be a Map')
  assert(Array.isArray(ankr._contractLogSubs), 'ankr._contractLogSubs should be an array')
  assert.strictEqual(ankr._MAX_SUB_SIZE, 10000, 'ankr._MAX_SUB_SIZE should be 10000')
  await ankr.stop()
  t.pass()
})

test('Ankr start method', async (t) => {
  const ankr = new Ankr(config)

  // Mock the necessary methods to avoid actual network calls
  ankr._addRoutes = () => {}
  ankr._subNewBlock = async () => {}
  ankr.web3.eth.getBlockNumber = async () => 1000

  await ankr.start()

  assert(ankr._subs instanceof Map, 'ankr._subs should still be a Map after start')
  t.pass()
  await ankr.stop()
})

test('Ankr _isAccount method', async (t) => {
  const ankr = new Ankr(config)

  // Test account address
  ankr.web3.eth.getCode = async () => '0x'
  const isAccount = await ankr._isAccount('0x1234567890123456789012345678901234567890')
  assert.strictEqual(isAccount, true, 'Should return true for an account address')

  // Test contract address
  ankr.web3.eth.getCode = async () => '0x123456'
  const isContract = await ankr._isAccount('0x1234567890123456789012345678901234567890')
  assert.strictEqual(isContract, false, 'Should return false for a contract address')
  await ankr.stop()
})

test('Ankr _getEventSubs method', async (t) => {
  const ankr = new Ankr(config)
  const eventName = 'testEvent'

  ankr._subs.set('sub1', { [eventName]: ['event1'], send: () => {} })
  ankr._subs.set('sub2', { [eventName]: ['event2'], send: () => {} })
  ankr._subs.set('sub3', { otherEvent: ['event3'], send: () => {} })

  const filteredSubs = ankr._getEventSubs(eventName)

  assert.strictEqual(filteredSubs.length, 2, 'Should return 2 subscriptions')
  assert(Array.isArray(filteredSubs[0].event), 'Subscription event should be an array')
  assert.strictEqual(typeof filteredSubs[0].send, 'function', 'Subscription should have a send function')
  await ankr.stop()
})

test('Ankr _addSub method', async (t) => {
  const ankr = new Ankr(config)
  const subData = {
    send: () => {},
    error: () => {},
    evName: 'testEvent',
    param: ['param1', 'param2'],
    cid: 'testCid'
  }

  ankr._addSub(subData)

  const addedSub = ankr._subs.get('testCid')
  assert(addedSub, 'Subscription should be added to _subs')
  assert.strictEqual(addedSub.send, subData.send, 'Added sub should have correct send function')
  assert.strictEqual(addedSub.error, subData.error, 'Added sub should have correct error function')
  assert.deepStrictEqual(addedSub.testEvent, subData.param, 'Added sub should have correct event parameters')
  ankr.stop()
})

test('Ankr methods', async (t) => {
  t.plan(13)

  const ankr = new Ankr(config)
  await ankr.start()

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

  ankr._apiStatus(req, {
    ...res,
    test: function (res) {
      t.ok(res.result.blockHeader >= 0, 'blockHeader is bigger than 0')
    }
  })

  req.body.param = [{
    address: '0x52b572e36db2d6e07f3d07a88f50695781dafa98'
  }]

  await ankr._getTransactionsByAddress(req, {
    ...res,
    test: function (res) {
      const result = res.result
      const tx = result[0]
      t.ok(result.length > 0, 'returns many transactions')
      t.ok(Number.isInteger(tx.value), 'value is integer')
      t.ok(Number.isInteger(tx.gasUsed), 'gasUsed is integer')
      t.ok(Number.isInteger(tx.gasPrice), 'gasPrice is integer')
      t.ok(Number.isInteger(tx.gas), 'gas is integer')
      t.ok(Number.isInteger(tx.timestamp), 'timestamp is integer')
    }
  })

  req.body.param = [{
    fromAddress: '0xa6EBD7CbdC447c7429a9cC7F78110373F0Aa0804',
    contractAddress: '0xbF43558373B4ED1E024186F18f611c0e209d1cEC'
  }]

  await ankr._getTokenTransfers(req, {
    ...res,
    test: function (res) {
      const result = res.result
      const tokenTransfer = result[0]
      t.ok(result.length > 0, 'returns many token transfers')
      t.ok(Number.isInteger(tokenTransfer.value), 'value is integer')
    }
  })

  await ankr._wsSubscribeAccount({
    ...req,
    params: [
      spec.addr,
      [spec.token]
    ],
    send: function (ev, data) {
      t.ok(ev === 'subscribeAccount', 'event name is correct')
      t.ok(data.addr === spec.addr.toLowerCase(), 'addr is correct')
      t.ok(data.token === spec.token, 'token is correct')
      t.ok(data.tx.height === 1000, 'height is correct')
    }
  })

  ankr._emitContractEvent(spec.token, {
    to: spec.addr,
    from: '0xa6EBD7CbdC447c7429a9cC7F78110373F0Aa0804',
    value: '1'
  }, {
    blockNumber: 1000,
    transactionHash: '0x1a2258b7b54114e5263ed7749b547c235a1de29bbe5831725f6c37a222ccdbad'
  })
})
