const BaseServer = require('./proxy')
const fetch = require("node-fetch")
const { Web3, FMT_NUMBER, FMT_BYTES } = require('web3')
const config =  {
  uri : 'http://localhost:8080'
}

class TrueBlocks extends BaseServer {

  constructor(config = {}) {
    super(config)
    this.web3 = new Web3('http://localhost:8545')
  }

  start() {
    this._addRoutes()
    return super.start()
  }

  async _callApi(path, qs){
    if(qs) {
      qs = '?'+new URLSearchParams(qs).toString()
    } else {
      qs = ''
    }
    const response = await fetch(`${config.uri}${path}${qs}`, {
      method : 'get',
      headers: {'Content-Type': 'application/json'},
    });
    return response.json();
  }

  _addRoutes() {

    this._addMethod({
      method : 'status',
      handler : this._apiStatus.bind(this)
    })
    this._addMethod({
      method : 'block',
      handler : this._apiStatus.bind(this)
    })

    this._addMethod({
      method : 'getTransactionsByAddress',
      handler : this._getTransactionsByAddress.bind(this)
    })
  }

  async _apiStatus(req, reply) {

    const res = await this._callApi('/status')
    reply.send(this._result(req.body.id, res))

  }
  

  async _getTransactionsByAddress(req,reply) {
    const eth = this.web3.eth
    const query = req.body.param.pop()
    const id = req.body.id
    const maxRecords = query.pageSize || 100
    const firstBlock = query.fromBlock || 20172292 
    const lastBlock = query.toBlock || Number(await eth.getBlockNumber())
    const addr = query.address
    const data = []

    for (var i = firstBlock; i <= lastBlock; i++) {
      var block = await eth.getBlock(i, true, { number: FMT_NUMBER.NUMBER , bytes: FMT_BYTES.HEX });
      if (block != null && block.transactions != null) {
        block.transactions.every( function(e) {
          if ( addr == e.from || addr == e.to) {
            data.push(e)
          }
          if(data.length === maxRecords) return false
          return true
        })
      }
    }
    return reply.send(this._result(id, data))
  }


}

module.exports = TrueBlocks
