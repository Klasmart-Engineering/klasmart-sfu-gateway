import Redis = require("ioredis")
import http, {IncomingMessage} from "http";
import httpProxy from "http-proxy";
import {Duplex} from "stream"

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT) || undefined,
  password: process.env.REDIS_PASS || undefined,
  lazyConnect: true,
});


async function getSfuAddress(roomId: string) {
  const sfu = RedisKeys.roomSfu(roomId);
  const address = await redis.get(sfu.key);
  if(address) { return address; }
  // const notify = RedisKeys.roomNotify(roomId);
  // let lastNotifyIndex = "$";
  // const endTime =  Date.now() + 10*1000;
  // while (Date.now() < endTime) {
  //     const responses = await redis.xread(
  //         "BLOCK", 10,
  //         "STREAMS",
  //         notify.key,
  //         lastNotifyIndex,
  //     );
  //     if (!responses) { continue; }
  //     for (const [, response] of responses) {
  //         for (const [id, keyValues] of response as any) {
  //             lastNotifyIndex = id;
  //             if(keyValues[0] !== "json") { continue }
  //             const { sfuAddress } = JSON.parse(keyValues[1])
  //             if(sfuAddress) {return sfuAddress as string;}
  //         }
  //     }
  // }
}

//TODO: Make RedisKeys shared component a library
class RedisKeys {
  public static roomSfu (roomId: string) {
    return { key: `${RedisKeys.room(roomId)}:sfu`, ttl: 3600 };
  }

  public static roomNotify (roomId: string) {
    return { key: `${RedisKeys.room(roomId)}:notify`, ttl: 3600 };
  }

  private static room (roomId: string): string {
    return `room:${roomId}`;
  }
}

const port = Number(process.env.PORT) || 8002
async function main() {
  try {
    await redis.connect();
    console.log("🔴 Redis database connected");
    
    const proxy = httpProxy.createProxyServer({});

    http.createServer((req, res) => {
      console.log("request")
      if(req.url === "/server-health") {
        res.statusCode = 200
        res.statusMessage = "Ok"
      } else {
        res.statusCode = 400
      }
      res.end()
    })
    .on('upgrade', async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      try{
        if(!req.url) { socket.end(); return; }
        const match = req.url.match(/^\/sfu\/([^\/]*)/)
        if(!match) { socket.end(); return; }
        const roomId = match[1]
        
        const sfuAddress = await getSfuAddress(roomId)
        if(!sfuAddress) { socket.end(); return; }
        const target = `ws://${sfuAddress}`
        console.log(target)
        proxy.ws(req, socket, head, { target, ignorePath: true })
      } catch(e) {
        socket.end()
        console.error(e)
      }
    })
    .listen(port, () => {
      console.log(`🌎 Server available on port ${port}`)
      process.on('uncaughtException',  (err) => { console.log(err) }); 
    })
  } catch(e) {
    console.error(e)
    process.exit(-1)
  }

}

main()