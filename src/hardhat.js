const BaseServer = require('./proxy')
const { Web3, FMT_NUMBER, FMT_BYTES } = require('web3')

const EVENTS = {
  SUB_ACCOUNT: 'subscribeAccount'
}

const TOPIC_SIG = Web3.utils.sha3('Transfer(address,address,uint256)')

class Hardhat extends BaseServer {
  constructor (config = {}) {
    super(config)
    this.config = config
    this.web3 = new Web3(config.web3)
    this.web3.defaultReturnFormat = {
      number: FMT_NUMBER.NUMBER
    }
    this._subs = new Map()
    this._contractLogSubs = []
    this._MAX_SUB_SIZE = 10000
  }

  start () {
    this._addRoutes()
    super.start()
    this._web3Events()

    /**
    * @description Loop through all subs and if the value is set to zero, remove from array
    */
    setInterval(() => {
      for (const [k, v] of this._subs) {
        if (v === 0) this._subs.delete(k)
      }
    }, 5000)
  }

  _addRoutes () {
    this._addMethod({
      method: 'status',
      handler: this._apiStatus.bind(this)
    })
    this._addMethod({
      method: 'block',
      handler: this._apiStatus.bind(this)
    })

    this._addMethod({
      method: 'getTransactionsByAddress',
      handler: this._getTransactionsByAddress.bind(this)
    })
  }

  async _apiStatus (req, reply) {
    reply.send(this._result(req.body.id, null))
  }

  /**
  * @description Listen to Web3 Events
  */
  async _web3Events () {
    const web3 = this.web3
    const blockSub = await web3.eth.subscribe('newHeads')
    blockSub.on('data', async blockhead => {
      const filter = this._getEventSubs(EVENTS.SUB_ACCOUNT)
      for (const id of blockhead.transactions) {
        this._filterBlockTx(id, filter)
      }
    })
    blockSub.on('error', error =>
      console.log('Error when subscribing to New block header: ', error)
    )
  }

  _subscribeToLogs (contracts) {
    if (this._contractLogSubs.length === 50) return console.log('maximum number of contracts subscribed')
    contracts.forEach((addr) => {
      if (this._contractLogSubs.includes(addr)) return
      this._subToContract(addr)
    })
  }

  /**
   * @description Listen to token  events, and send message to user when detected relevant tx
  **/
  async _subToContract (contract) {
    const web3 = this.web3
    contract = contract.toLowerCase()
    const sub = await web3.eth.subscribe('logs', {
      address: contract,
      topics: [TOPIC_SIG]
    })

    const emitEvent = (decoded, log) => {
      const filter = this._getEventSubs(EVENTS.SUB_ACCOUNT)
      filter.forEach((sub) => {
        sub.event.forEach(([addr, tokens]) => {
          if (!tokens.includes(contract)) return
          if (decoded.from.toLowerCase() !== addr && decoded.to.toLowerCase() !== addr) return

          sub.send(EVENTS.SUB_ACCOUNT, {
            addr,
            token: contract,
            tx: {
              height: log.blockNumber,
              txid: log.transactionHash,
              from: decoded.from,
              to: decoded.to,
              value: decoded.value && decoded.value.toString()
            }
          })
        })
      })
    }

    sub.on('data', (log) => {
      let decoded
      try {
        decoded = web3.eth.abi.decodeLog(
          [
            { type: 'address', name: 'from', indexed: true },
            { type: 'address', name: 'to', indexed: true },
            { type: 'uint256', name: 'value' }
          ],
          log.data,
          log.topics.slice(1)
        )
      } catch (err) {
        console.log('Failed to decode event', log)
        return
      }
      emitEvent(decoded, log)
    })
    sub.on('error', error =>
      console.log('Error when subscribing to contract: ', contract, error)
    )
  }

  /**
  * @description Filter transactions in block and send websocket msg
  * @param {String} txid transaction id
  * @param {EventSub}
  * @param {string} evName event name
  * @emits evName
  */
  async _filterBlockTx (txid, filter, evName) {
    const tx = await this.web3.eth.getTransaction(txid, {})

    filter.forEach((sub) => {
      sub.event.forEach(([addr]) => {
        if (!(tx.from === addr || tx.to === addr)) return true
        sub.send(evName, {
          tx, addr
        })
      })
    })
  }

  async _getTransactionsByAddress (req, reply) {
    const eth = this.web3.eth
    const query = req.body.param.pop()
    const id = req.body.id
    const maxRecords = query.pageSize || 100
    const firstBlock = query.fromBlock || 0
    const lastBlock = query.toBlock || Number(await eth.getBlockNumber())
    const addr = query.address
    const data = []

    for (let i = firstBlock; i <= lastBlock; i++) {
      const block = await eth.getBlock(i, true, { number: FMT_NUMBER.NUMBER, bytes: FMT_BYTES.HEX })
      if (block != null && block.transactions != null) {
        block.transactions.every(function (e) {
          if (addr === e.from || addr === e.to) {
            data.push(e)
          }
          if (data.length === maxRecords) return false
          return true
        })
      }
    }
    return reply.send(this._result(id, data))
  }

  /**
  * @description check if an address is a smart contract or account
  * @param {String} addr eth address
  * @returns {Promise<Boolean>}
  */
  async _isAccount (addr) {
    let res
    try {
      res = await this.web3.eth.getCode(addr)
    } catch (err) {
      return false
    }
    return res === '0x'
  }

  _getEventSubs (evName) {
    let filter = []
    for (const [, con] of this._subs) {
      const ev = con[evName]
      if (!ev) continue
      filter = filter.concat({ event: ev, send: con.send })
    }
    return filter
  }

  /**
  * @description subscribe to account and tokens for a user
  **/
  async _wsSubscribeAccount (req) {
    let account = req?.params[0]
    let tokens = req?.params[1] || []
    const evName = EVENTS.SUB_ACCOUNT
    if (this._subs.size >= this._MAX_SUB_SIZE) {
      console.log('reached max number of subscriptions')
      return req.error('server is not available')
    }
    if (!await this._isAccount(account)) {
      return req.error('not an eth account')
    }
    if (await this._isAccount(tokens)) {
      return req.error('not an eth contract')
    }
    account = account.toLowerCase()
    tokens = tokens.map((str) => str.toLowerCase())
    if (!account) return req.error('account not sent')
    let cidSubs = this._getCidSubs(req.cid, evName)
    if (!cidSubs) {
      cidSubs = []
    }
    cidSubs.push([account, tokens])

    this._subscribeToLogs(tokens)
    console.log(`New sub: acct: ${account} - tokens ${tokens}`)

    this._addSub({
      send: req.send,
      error: req.error,
      evName,
      param: cidSubs,
      cid: req.cid
    })
  }

  _getCidSubs (cid, evName) {
    const userSubs = this._subs.get(cid)
    if (!userSubs) return null
    return userSubs[evName] || null
  }

  _addSub (data) {
    let userSubs = this._subs.get(data.cid)
    if (userSubs === 0) return
    if (!userSubs) {
      userSubs = {}
      userSubs.send = data.send
      userSubs.error = data.error
    }
    userSubs[data.evName] = data.param
    this._subs.set(data.cid, userSubs)
  }

  _wsCloseCid (opts) {
    this._subs.set(opts.cid, 0)
  }
}

module.exports = Hardhat
