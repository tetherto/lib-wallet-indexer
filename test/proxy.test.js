const test = require('brittle')
const fetch = require("node-fetch")
const ProxyServer = require('../src/proxy')
const TrueBlock = require('../src/eth.trueblocks')

async function callServer(method, param, path) {
  const response = await fetch('http://127.0.0.1:8008/'+(path || "jsonrpc"), {
    method : 'post',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      param,
      id: (Math.random()*10e10).toFixed(0)
    })
  });
  return response.json();
}

test('Proxy ', async function (t) {
  const methods = [
    {
      method: 'ping',
      path: "ping",
      params: [[]],
      expected: [
        'pong'
      ]
    }
  ]

  t.test('Methods', async function (t) {
    const p = new ProxyServer()
    await p.start()
    await Promise.all(methods.map(async (m) => {
      t.comment(`testing method:  ${m.method}`)
      const res = await callServer(m.method, m.params, m.path)
      t.ok(JSON.stringify(res.result) === JSON.stringify(m.expected), `Result matches ${m.expected}`)
    }))
    await p.stop()
    t.pass('stopped server')
  })
})

test('eth.trueblock', async function (t) {
  const methods = [
    {
      method: 'status',
      params: [[]],
      expected: (t, res) => {
        t.ok(res.meta.chain === 'mainnet', 'expected chain')
      }
    }
  ]

  t.test('Methods', async function (t) {
    const p = new TrueBlock()
    await p.start()
    await Promise.all(methods.map(async (m) => {
      t.comment(`testing method:  ${m.method}`)
      const res = await callServer(m.method, m.params)
      m.expected(t,res.result)
    }))
    await p.stop()
    t.pass('stopped server')
  })
})
