import "newrelic";
import Redis from "ioredis";
import http, { IncomingMessage } from "http";
import httpProxy from "http-proxy";
import { Duplex } from "stream"

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
  return null;
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
      if(req.url === "/server-health") {
        res.statusCode = 200
        res.statusMessage = "Ok"
      } else {
        res.statusCode = 400
      }
      console.log("Request: "+req.url+" ("+res.statusCode+")")
      res.end()
    })
    .on('upgrade', async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      try{
        if(!req.url) { 
          socket.end(); 
          console.error("Empty req.url on upgrade to websocket")
          return; 
        }
        const match = req.url.match(/^\/sfu\/([^\/]*)/)
        if(!match) { 
          socket.end(); 
          console.error("No roomid found in req.url ("+req.url+") on upgrade to websocket")
          return; 
        }
        const roomId = match[1]
        
        const sfuAddress = await getSfuAddress(roomId)
        if(!sfuAddress) { 
          socket.end(); 
          console.error("No sfu address found in Redis for roomid: "+roomId+") on upgrade to websocket")
          return; 
        }

        const target = `ws://${sfuAddress}`
        console.log("Proxying to target: "+target)
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
