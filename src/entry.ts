import "newrelic";
import { RedisRegistrar } from "./redis";
import Redis, {Cluster, Redis as IORedis} from "ioredis";
import {createServer, getEnvNumber} from "./service";
import dotenv from "dotenv";

async function main() {
    try {
        dotenv.config();
        process.on("uncaughtException",  (err) => { console.log(err); });

        const redisMode: string = process.env.REDIS_MODE ?? "NODE";
        const redisPort = Number(process.env.REDIS_PORT ?? 6379);
        const host = process.env.REDIS_HOST;
        const password = process.env.REDIS_PASS;
        const lazyConnect = true;
        let redis: IORedis | Cluster;

        if (redisMode === "CLUSTER") {
            redis = new Cluster([
                {
                    port: redisPort,
                    host
                }
            ],
            {
                lazyConnect,
                redisOptions: {
                    password
                }
            });
        } else {
            redis = new Redis({
                host,
                port: redisPort,
                password,
                lazyConnect: true,
                reconnectOnError: (err) => err.message.includes("READONLY"),
            });
        }
        await redis.connect();
        console.log("🔴 Redis database connected");

        const registrar = new RedisRegistrar(redis);
        const app = createServer(registrar);

        const port = getEnvNumber(process.env.PORT, 8002);
        await app.listen(port);
        console.log(`🌎 Server available on port ${port}`);

    } catch(e) {
        console.error(e);
        process.exit(-1);
    }
}

main();
