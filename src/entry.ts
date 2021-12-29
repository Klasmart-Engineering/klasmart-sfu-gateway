import "newrelic";
import Redis from "ioredis";
import http, { IncomingMessage } from "http";
import httpProxy from "http-proxy";
import { Duplex } from "stream";
import dotenv from "dotenv";

async function getSfuAddressV1(roomId: string, redis: Redis.Redis | Redis.Cluster) {
    const sfu = RedisKeys.roomSfu(roomId);
    const address = await redis.get(sfu.key);
    if(address) { return address; }
    return null;
}

async function getSfuAddressV2(sfuId: string, redis: Redis.Redis | Redis.Cluster) {
    const sfu = RedisKeys.sfuId(sfuId);
    const address = await redis.get(sfu);
    if(address) { return address; }
    return null;
}

//TODO: Make RedisKeys shared component a library
class RedisKeys {
    public static sfuId(id: string) {
        return `sfu:{${id}}`;
    }

    public static roomSfu (roomId: string) {
        return { key: `${RedisKeys.room(roomId)}:sfu`, ttl: 3600 };
    }

    private static room (roomId: string): string {
        return `room:{${roomId}}`;
    }
}

async function main() {
    dotenv.config();
    try {
        const host = process.env.REDIS_HOST;
        const port = Number(process.env.REDIS_PORT) || undefined;
        const password = process.env.REDIS_PASS;
        const lazyConnect = true;
        const redisMode = process.env.REDIS_MODE ?? "NODE";

        const appPort = Number(process.env.PORT) || 8002;

        let redis: Redis.Redis | Redis.Cluster;
        if (redisMode === "CLUSTER") {
            redis = new Redis.Cluster([
                {
                    host,
                    port
                }
            ], {
                lazyConnect,
                redisOptions: {
                    password
                }
            });
        } else {
            redis = new Redis({
                host,
                port,
                password,
                lazyConnect,
            });
        }

        await redis.connect();
        console.log("🔴 Redis database connected");

        const proxy = httpProxy.createProxyServer({});

        http.createServer((req, res) => {
            if(req.url === "/server-health") {
                res.statusCode = 200;
                res.statusMessage = "Ok";
            } else {
                res.statusCode = 400;
            }
            console.log(`Request: ${req.url} (${res.statusCode})`);
            res.end();
        })
            .on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
                try{
                    if(!req.url) {
                        socket.end();
                        console.error("Empty req.url on upgrade to websocket");
                        return;
                    }
                    const v1Match = req.url.match(/^\/sfu\/([^/]*)/);
                    const v2Match = req.url.match(/^\/v2\/sfu\/([^/]*)/);
                    let sfuAddress = undefined;
                    if (v2Match) {
                        const sfuId = v2Match[1];
                        sfuAddress = await getSfuAddressV2(sfuId, redis);
                        if(!sfuAddress) {
                            socket.end();
                            console.error(`No sfu address found in Redis for SFU ID: ${sfuId} on upgrade to websocket`);
                            return;
                        }
                    } else if (v1Match) {
                        const roomId = v1Match[1];
                        sfuAddress = await getSfuAddressV1(roomId, redis);
                        if(!sfuAddress) {
                            socket.end();
                            console.error(`No sfu address found in Redis for Room ID: ${roomId} on upgrade to websocket`);
                            return;
                        }
                    } else {
                        socket.end();
                        console.error(`No id found in req.url (${req.url}) on upgrade to websocket`);
                        return;
                    }

                    const target = `ws://${sfuAddress}`;
                    console.log("Proxying to target: "+target);
                    proxy.ws(req, socket, head, { target, ignorePath: true });
                } catch(e) {
                    socket.end();
                    console.error(e);
                }
            })
            .listen(appPort, () => {
                console.log(`🌎 Server available on port ${appPort}`);
                process.on("uncaughtException",  (err) => { console.log(err); });
            });
    } catch(e) {
        console.error(e);
        process.exit(-1);
    }
}

main();
