const Hardhat = require('./src/hardhat.js')
const config = require('./config.json')

async function main () {
  const server = new Hardhat(config)

  server.start()
}

main()
