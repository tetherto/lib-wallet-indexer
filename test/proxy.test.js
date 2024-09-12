const test = require('brittle')
const fetch = require('node-fetch')
const Hardhat = require('../src/hardhat')

async function callServer (method, param, path) {
  const response = await fetch('http://127.0.0.1:8008/' + (path || 'jsonrpc'), {
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

test('eth.hardhat', async function (t) {
  const methods = [
    {
      method: 'status',
      params: [],
      expected: (t, res) => {
        t.ok(res.blockHeader >= 0, 'expected block header')
      }
    }
  ]

  t.test('Methods', async function (t) {
    const p = new Hardhat()
    await p.start()

    await Promise.all(methods.map(async (m) => {
      t.comment(`testing method:  ${m.method}`)
      const res = await callServer(m.method, m.params)
      m.expected(t, res.result)
    }))
    await p.stop()
    t.pass('stopped server')
  })
})
