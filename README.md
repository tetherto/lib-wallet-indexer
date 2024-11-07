# lib-wallet-indexer

indexer service for Ethereum with JSON-RPC and Websocket api

## Feaures:

### JSON-RPC
**getTransactionsByAddress:** Get ETH transactions by address.


### WebSocket:
**subscribeToAccount:** Websocket events for new ERC20 token and ETH transfers for an address.

## Backends:
### Ankr 
We provide a proxy for using [Ankr](https://www.ankr.com/) as your data provider. Using the Ankr proxy allows your to easily access ETH mainnet or testnets

### Hardhat 
Using the the [Hardhat](hardhat.org/) proxy, you're able run an indexer on your local hardhat instance.
See the [wallet-test-tools](https://github.com/tetherto/wallet-lib-test-tools/tree/main/src/eth) repo to setup your local instance.

### Tron
A proxy for interacting with Tron blockchain. `tron_api_key` in config is optional, depends on your provider.

## Run
```sh
npm install
cp ./config.json.example ./config.json 

# For running with hardhat backend
npm run start-hardhat

# For running against ankr
npm run start-ankr

# For running tron
npm run start-tron

# For running tron tests
npm run test:tron

```


