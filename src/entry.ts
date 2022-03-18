import "newrelic";
import {RedisRegistrar} from "./redis";
import Redis, {Cluster, Redis as IORedis} from "ioredis";
import {createServer, getEnvNumber} from "./service";
import dotenv from "dotenv";
import {Logger} from "./logger";

async function main() {
    try {
        dotenv.config();
        process.on("uncaughtException",  (err) => { Logger.error(err); });

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
                    password,
                    showFriendlyErrorStack: true,
                    reconnectOnError: () => true,

                },
                clusterRetryStrategy(times: number): number {
                    return Math.min(100 + times * 2, 2000);
                },
                retryDelayOnClusterDown: 2000,
                slotsRefreshInterval: 2000,
                slotsRefreshTimeout: 5000,
            });
        } else {
            redis = new Redis({
                host,
                port: redisPort,
                password,
                lazyConnect: true,
                reconnectOnError: () => true,
                retryStrategy: (times: number) => Math.min(times * 50, 2000),
                showFriendlyErrorStack: true,
            });
        }
        await redis.connect();
        Logger.info("🔴 Redis database connected");

        const registrar = new RedisRegistrar(redis);
        const app = createServer(registrar);

        const port = getEnvNumber(process.env.PORT, 8002);
        await app.listen(port);
        Logger.info(`🌎 Server available on port ${port}`);

    } catch(e) {
        Logger.error(e);
        process.exit(-1);
    }
}

main();
