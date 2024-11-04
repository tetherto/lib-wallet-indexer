// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


const Ankr = require('../src/ankr')
const config = require('../config.json')

async function main() {
  const ankr = new Ankr(config)
  await ankr.start()
  const req = {
    body: {
      id: 'test'
    }
  }


  req.body.param = [{
    address: '0xf8200ce84c3151f64a79e723245544e1e58badec'
  }
  ]
  await ankr._wsSubscribeAccount({
    ...req,
    params: [
      '0xf8200cE84C3151F64A79e723245544e1E58baDec',
      ['0xbF43558373B4ED1E024186F18f611c0e209d1cEC']
    ],
    send: function (ev, data) {
      console.log(ev, data)
    }
  })
}

main()
