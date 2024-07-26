const Hardhat = require('./src/hardhat.js')
const config = require('./config.json')

async function main () {
  console.log('starting indexer')
  console.log(config)
  const server = new Hardhat(config)

  server.start()
}

main()
