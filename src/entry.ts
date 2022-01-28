import "newrelic";
import { RedisRegistrar } from "./redis";
import Redis from "ioredis";
import { createExpressServer } from "./express";
import dotenv from "dotenv";

async function main() {
    try {
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
        const app = createExpressServer(registrar);
    
        const port = Number(process.env.PORT) || 8002;
        app.listen(port, () => {
            console.log(`🌎 Server available on port ${port}`);
            process.on("uncaughtException",  (err) => { console.log(err); }); 
        });
    

    } catch(e) {
        console.error(e);
        process.exit(-1);
    }
}

main();
