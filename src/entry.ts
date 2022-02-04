import "newrelic";
import { RedisRegistrar } from "./redis";
import Redis from "ioredis";
import { createServer } from "./service";
import dotenv from "dotenv";

async function main() {
    try {
        dotenv.config();
        process.on("uncaughtException",  (err) => { console.log(err); });
        //TODO: Cluster
        const redis = new Redis({
            host: process.env.REDIS_HOST,
            port: Number(process.env.REDIS_PORT) || undefined,
            password: process.env.REDIS_PASS || undefined,
            lazyConnect: true,
            // TODO: reconnectOnError
        });
        await redis.connect();
        console.log("🔴 Redis database connected");

        const registrar = new RedisRegistrar(redis);
        const app = createServer(registrar);

        const port = Number(process.env.PORT) || 8002;
        await app.listen(port);
        console.log(`🌎 Server available on port ${port}`);

    } catch(e) {
        console.error(e);
        process.exit(-1);
    }
}

main();
