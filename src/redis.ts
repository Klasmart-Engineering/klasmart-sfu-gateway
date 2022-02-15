import {Cluster, Redis as IORedis} from "ioredis";
import {MAX_SFU_LOAD} from "./service";

export type Type<T> = string & {
    /* This value does not exist during execution and is only used for type matching during compiletime */
    __TYPE__: string extends T ? unknown : T
};
export type UserId = Type<"UserId">;
export const newUserId = (id: string) => id as UserId;

export type SfuId = Type<"SfuId">;
export const newSfuId = (id: string) => id as SfuId;

export type ProducerId = Type<"ProducerId">;
export const newProducerId = (id: string) => id as ProducerId;

export type RoomId = Type<"RoomId">;
export const newRoomId = (id: string) => id as RoomId;

export type TrackInfo = {
    sfuId: SfuId,
    producerId: ProducerId,
    name?: string,
    sessionId?: string,
};

export type TrackInfoEvent = {
    add: TrackInfo
} | {
    remove: ProducerId
} | {
    sfuId: SfuId
};

export type SfuStatus = {
    endpoint: string
    producers: number
    consumers: number
    lastUpdateTimestamp?: number
};

export type SfuRegistrar =  {
    getSfuIds(): Promise<SfuId[]>;
    getSfuStatus(sfuId: SfuId): Promise<SfuStatus>;
    getAvailableSfu(newLoad: number): Promise<SfuId>;
    getRandomSfuId(): Promise<SfuId>;
};

export type TrackRegistrar = {
    getTracks(roomId: RoomId): Promise<TrackInfo[]>;
    waitForTrackChanges(roomId: RoomId, cursor?: string): Promise<{cursor?: string, events?: TrackInfoEvent[]}>;
};

export class RedisRegistrar implements SfuRegistrar, TrackRegistrar {
    // Gets an SFU which has the capacity to handle the new load. If no SFU can fully handle the new load, return the SFU with the least load.
    public async getAvailableSfu(newLoad: number) {
        const sfuIds = await this.getSfuIds();
        const sfuStatuses = await Promise.all(sfuIds.map(async sfuId => {
            return {id: sfuId, status: await this.getSfuStatus(sfuId) };
        }));

        if (sfuStatuses.length === 0) {
            throw new Error("No SFUs are reporting statuses");
        }

        // newLoad is too high for any single SFU to handle, so only consider SFUs that can handle an additional track.
        if (newLoad > MAX_SFU_LOAD) {
            newLoad = 3;
        }

        const availableSfus = sfuStatuses.filter(sfu => MAX_SFU_LOAD - (sfu.status.producers + sfu.status.consumers) > newLoad);

        if (availableSfus.length > 0) {
            const randomIndex = Math.floor(Math.random()*availableSfus.length);
            return availableSfus[randomIndex].id;
        }

        throw new Error("No SFU available that can handle more load");
    }

    public async getSfuAddress(sfuId: SfuId) {
        const status = await this.getSfuStatus(sfuId);
        return status?.endpoint;
    }

    public async getRandomSfuId() {
        const sfuIds = await this.getSfuIds();
        const randomIndex = Math.floor(Math.random()*sfuIds.length);
        return sfuIds[randomIndex];
    }

    public async getSfuIds() {
        const key = RedisRegistrar.keySfuIds();
        await this.removeOldEntries(key);
        const list = await this.getSortedSet(key);
        return list.map(id => newSfuId(id));
    }

    public async getSfuStatus(sfuId: SfuId) {
        const key = RedisRegistrar.keySfuStatus(sfuId);
        const status = await this.getJsonEncoded<SfuStatus>(key);
        if (!status) {
            throw new Error(`SFU ${sfuId} not found`);
        }
        return status;
    }

    public async getTracks(roomId: RoomId) {
        const key = RedisRegistrar.keyRoomTracks(roomId);

        const oldestTimestamp = Date.now() - 15 * 1000;
        const numberDeleted = await this.redis.zremrangebyscore(key, 0, oldestTimestamp);
        if (numberDeleted > 0) { console.info(`Deleted ${numberDeleted} outdated entries from '${key}'`); }

        const list = await this.getSortedSet(key);
        console.log(list);
        return list.flatMap(track => JsonParse<TrackInfo>(track) || []);
    }

    public async waitForTrackChanges(roomId: RoomId, cursor="0") {
        const redis = this.redis.duplicate();
        try {
            const key = RedisRegistrar.keyNotification(RedisRegistrar.keyRoomTracks(roomId));
            const readResult = await redis.xread("BLOCK", 10000, "STREAMS", key, cursor);

            if (!readResult) { return { cursor }; }

            const [ [ , streamItems ] ] = readResult;
            return {
                cursor: streamItems[streamItems.length-1][0],
                events: streamItems.flatMap(([,keyValues]) =>
                    deserializeRedisStreamFieldValuePairs<TrackInfoEvent>(keyValues) ?? []
                ),
            };
        } finally {
            redis.disconnect();
        }
    }

    public constructor(
        private readonly redis: IORedis | Cluster
    ) {}

    private async getJsonEncoded<T>(key: string) {
        try {
            const status = await this.redis.get(key);
            if(status) { return JSON.parse(status) as T; }
            return;
        } catch(e) {
            console.error(e);
            return;
        }
    }

    private async getSortedSet(key: string) {
        const results: string[] = [];
        let cursor = "0";
        do {
            const [nextCursor, items] = await this.redis.zscan(key, cursor);
            for(let i = 0; i+1 < items.length; i+=2) { results.push(items[i]); }
            cursor = nextCursor;
        } while(cursor !== "0");
        return results;
    }

    private static keySfuIds() { return "sfuids"; }
    private static keySfuStatus(sfuId: SfuId) { return `sfu:${sfuId}:status`; }
    private static keyRoomTracks(roomId: RoomId) { return `room:${roomId}:tracks`; }
    private static keyNotification(key: string) { return `${key}:notification`; }

    /* Legacy behavior for sfu v1 */
    public async getLegacySfuAddressByRoomId(roomId: string) {
        const key = RedisRegistrar.roomSfu(roomId);
        const address = await this.redis.get(key);
        if(!address) { return; }
        return address;
    }

    private async removeOldEntries(key: string, probability = 0.1) {
        if (!roll(probability)) {
            return;
        }

        const oldestTimestamp = Date.now() - 15 * 1000;
        const numberDeleted = await this.redis.zremrangebyscore(key, 0, oldestTimestamp);
        if (numberDeleted > 0) { console.info(`Deleted ${numberDeleted} outdated entries from '${key}'`); }
    }

    public static roomSfu (roomId: string) { return `room:${roomId}:sfu`; }
}

function deserializeRedisStreamFieldValuePairs<T>(fieldValues: string[]) {
    for(let i = 0; i+1 < fieldValues.length; i+=2) {
        if(fieldValues[i] !== "json") { continue; }
        const value = JsonParse<T>(fieldValues[i+1]);
        if(value !== undefined) { return value; }
    }
    return;
}

function JsonParse<T>(serialized: string) {
    try {
        return JSON.parse(serialized) as T;
    } catch(e) {
        console.error(`Failed to deserialize value: ${e}`);
        return;
    }
}

function roll(probability: number): boolean {
    const roll = Math.random();
    return roll < probability;
}
