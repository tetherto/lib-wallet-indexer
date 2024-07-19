const BaseServer = require('./proxy')
const fetch = require("node-fetch")
const { Web3, FMT_NUMBER, FMT_BYTES } = require('web3')
const config =  {
  uri : 'http://localhost:8080',
}

const EVENTS = {
  SUB_ACCOUNT : "subscribeAccount"
}


class Hardhat extends BaseServer {

  constructor(config = {}) {
    super(config)
    this.web3 = new Web3('ws://localhost:8545')
    this.web3.defaultReturnFormat = {
      number : FMT_NUMBER.NUMBER,
    }
    this._subs = new Map()
    this._MAX_SUB_SIZE = 10000
  }

  start() {
    this._addRoutes()
    super.start()
    this._web3Events()

    /**
    * @description Loop through all subs and if the value is set to zero, remove from array
    */
    setInterval(() => {
      for(let [k,v] of this._subs) {
        if(v === 0) this._subs.delete(k)
      }
    }, 5000)
  }

  /**
  * @description Call indexer api
  * @param {String} path the path portion of uri
  * @param {Object} qs Object that gets turned into querys string 
  * @returns {Object} response
  */
  async _callApi(path, qs){
    if(qs) {
      qs = '?'+new URLSearchParams(qs).toString()
    } else {
      qs = ''
    }
    const response = await fetch(`${config.uri}${path}${qs}`, {
      method : 'get',
      headers: {'Content-Type': 'application/json'},fsdf    });
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

    reply.send(this._result(req.body.id, null))

  }
  
  /**
  * @description Listen to Web3 Events
  */
  async  _web3Events() {
    const web3 = this.web3
    const blockSub = await web3.eth.subscribe('newHeads');
    blockSub.on('data', async blockhead => {
      const ev = this._getEventSubs(EVENTS.SUB_ACCOUNT)
      for(const id of blockhead.transactions) {
        this._filterBlockTx(id, ev, EVENTS.SUB_ACCOUNT)
      }
    });
    blockSub.on('error', error =>
      console.log('Error when subscribing to New block header: ', error),
    );
  }

  /**
  * @description Filter transactions in block and send websocket msg
  * @param {String} txid transaction id
  * @param {EventSub} 
  * @param {string} evName event name
  * @emits evName
  */
  async _filterBlockTx(txid,[param, events], evName) {
    const tx = await this.web3.eth.getTransaction(txid,{})
    param.forEach((addr) => {
      if(!(tx.from === addr || tx.to === addr )) return true 
      for(const ev of events) {
        const params = ev[evName] || []
        if(params.includes(addr)) {
          ev.send(evName,{ 
            tx,
            addr
          })
        }
      }
    })
  }

  async _getTransactionsByAddress(req,reply) {
    const eth = this.web3.eth
    const query = req.body.param.pop()
    const id = req.body.id
    const maxRecords = query.pageSize || 100
    const firstBlock = query.fromBlock || 0 
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

  /**
  * @description check if an address is a smart contract or account
  * @param {String} addr eth address
  * @returns {Boolean} 
  */
  async _isAccount(addr) {
    let res 
    try {
      res = await this.web3.eth.getCode(addr)
    } catch(err) {
      console.log(err)
      return false 
    }
    return res === '0x' 
  }

  _getEventSubs(evName) {
    let filter = []
    const subs = []
    for(let [cid,con] of this._subs) {
      const ev = con[evName]
      if(!ev) continue 
      filter = filter.concat(ev)
      subs.push(con)
    }
    return [filter, subs]
  }

  async _wsSubscribeAccount(req) {
    const account = req?.params[0]
    const evName = EVENTS.SUB_ACCOUNT
    if(this._subs.size >=  this._MAX_SUB_SIZE) {
      console.log('reached max sub size')
      return req.error('server is not available')
    }
    if(! await this._isAccount(account)) {
      return req.error('not an eth account')
    }
    if(!account) return req.error('account not sent')
    let cidSubs = this._getCidSubs(req.cid, evName)
    if(!cidSubs) {
      cidSubs = []
    }
    cidSubs.push(account)
    this._addSub({
      send: req.send,
      error: req.error,
      evName,
      param: cidSubs,
      cid: req.cid
    })
  }

  _getCidSubs(cid,evName) {
    let userSubs = this._subs.get(cid)
    if(!userSubs) return null
    return userSubs[evName] || null
  }

  _addSub(data) {
    let userSubs = this._subs.get(data.cid)
    if(userSubs === 0) return 
    if(!userSubs) {
      userSubs = {}
      userSubs.send = data.send
      userSubs.error = data.error
    }
    userSubs[data.evName] = data.param
    this._subs.set(data.cid, userSubs)
  }

  _wsCloseCid(opts) {
    this._subs.set(opts.cid, 0)
  }

}

module.exports = Hardhat
