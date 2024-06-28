const Hardhat = require('./src/hardhat.js')

async function main(){
  const server = new Hardhat({

  })
 
  await server.start()
}


main()
