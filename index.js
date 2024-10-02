const config = require('./config.json')

const servers = {
  hardhat : require('./src/hardhat.js'),
  ankr : require('./src/ankr.js')
}
async function main () {
  const servName = process.argv[2]?.toLowerCase()
  console.log(`Starting: ${servName}`)
  const Server = servers[servName]
  const server = new Server(config)
  server.start()
}

main()
