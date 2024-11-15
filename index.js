const config = require('./config.json')

const servers = {
  hardhat: require('./src/hardhat.js'),
  ankr: require('./src/ankr.js'),
  tron: require('./src/tron.js')
}
async function main () {
  const servName = process.argv[2]?.toLowerCase()

  if (!(servName in servers)) {
    console.log(`${servName} not supported. Available servers: ${Object.keys(servers)}`)
    process.exit(1)
  }

  console.log(`Starting: ${servName}`)
  const Server = servers[servName]
  const server = new Server(config)
  server.start()
}

main()
