# lib-wallet-indexer

Node.js indexer for Ethereum with JSON-RPC and Websocket api

## Feaures:

### JSON-RPC
**getTransactionsByAddress:** Get ETH transactions by address


### WebSocket:
**subscribeToAccount:** Websocket events for new transactions for an address. Supports ERC20 tokens and ETH transactions.


## Run
```
npm install
cp ./config.json.example ./config.json 

//For running with hardhat backend
npm run start-hardhat

//For running against ankr
npm run start-ankr

```

### Ankr proxy
We provide a proxy for using [Ankr](https://www.ankr.com/) as your data provider. Using the Ankr proxy allows your to easily access ETH mainnet or testnets

### Hardhat proxy
Using the the [Hardhat](hardhat.org/) proxy, you're able run an indexer on your local hardhat instance.
See the [wallet-test-tools](https://github.com/tetherto/wallet-lib-test-tools/tree/main/src/eth) repo to setup your local instance.


