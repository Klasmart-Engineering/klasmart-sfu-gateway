import httpProxy from "http-proxy";
import { WebSocketServer, WebSocket } from "ws";
import { getFromUrl, handleAuth } from "./auth";
import { newSfuId, RedisRegistrar, SfuId, TrackInfo, TrackInfoEvent } from "./redis";
import { Server } from "./server";
import { OrgId, ScheduleId, Scheduler} from "./scheduler";
import { Url } from "url";

export const MAX_SFU_LOAD = Number(process.env.MAX_SFU_LOAD) ?? 500;

export function createServer(registrar: RedisRegistrar) {
    const server = new Server();
    if (!process.env.CMS_ENDPOINT) {
        throw new Error("CMS_ENDPOINT environment variable must be set");
    }
    const cmsEndpoint = process.env.CMS_ENDPOINT;
    const scheduler = new Scheduler(cmsEndpoint);

    server.get("/server-health", (_req, res) => {
        res.statusCode = 200;
        res.statusMessage = "Ok";
        res.end();
    });

    const wss = new WebSocketServer({noServer: true});

    server.ws("/room", async (_params, socket, req, head, url) => {
        try {
            const { roomId, orgId, scheduleId, authCookie } = await handleAuth(req, url);
            const ws = await new Promise<WebSocket>(resolve => wss.handleUpgrade(req, socket, head, resolve));

            let currentCursor = `${Date.now()}`;
            {
                const tracks = await registrar.getTracks(roomId);
                const sfuId = selectSfu(url, registrar, tracks, scheduler, scheduleId, orgId, authCookie);
                const initialEvents = [
                    { sfuId },
                    ...tracks.map<TrackInfoEvent>(add => ({ add })),
                ];
                console.log(initialEvents);
                ws.send(JSON.stringify(initialEvents));
            }

            while (ws.readyState === WebSocket.OPEN) {
                const { cursor, events } = await registrar.waitForTrackChanges(roomId, currentCursor);
                if (events) { ws.send(JSON.stringify(events)); }
                currentCursor = cursor;
            }
        } catch(e) {
            console.error(e);
            if(socket.writable) { socket.end(); }
            if(socket.readable) { socket.destroy(); }
        }
    });

    const proxy = httpProxy.createProxyServer({});

    server.ws("/sfuid/:sfuId", async (params, socket, req, head) => {
        if (!params["sfuId"]) { throw new Error(`No sfuId found in req.url(${req.url})`); }
        const sfuId = newSfuId(params["sfuId"]);

        const sfuAddress = await registrar.getSfuAddress(sfuId);
        if (!sfuAddress) { throw new Error(`sfu address not found for sfuId("${sfuId}")`); }

        console.log(`Proxying to sfu(${sfuId}) at '${sfuAddress}' for [${req.socket.remoteFamily}](${req.socket.remoteAddress}:${req.socket.remotePort})`);
        const target = `ws://${sfuAddress}${req.url}`;
        proxy.ws(req, socket, head, { target, ignorePath: true });
    });

    /* Legacy behavior for sfu v1 */
    server.ws("/sfu/:roomId", async (params, socket, req, head) => {
        try {
            const roomId = params["roomId"];
            if (!roomId) { throw new Error(`No roomId in url(${req.url})`); }

            const sfuAddress = await registrar.getLegacySfuAddressByRoomId(roomId);
            if (!sfuAddress) { throw new Error(`No sfu address found for roomId(${roomId})`); }

            const target = `ws://${sfuAddress}`;
            console.log(`Proxying to target(${target})`);
            proxy.ws(req, socket, head, { target, ignorePath: true });
        } catch (e) {
            console.error(e);
            socket.end();
        }
    });

    return server;
}

async function selectSfu(
    url: Url,
    registrar: RedisRegistrar,
    tracks: TrackInfo[],
    scheduler: Scheduler,
    scheduleId: ScheduleId,
    orgId: OrgId,
    cookie: string,
) {
    try {
        const selectionStrategy = getFromUrl(url, "selectionStrategy") ?? "random";
        switch (selectionStrategy) {
        case "random":
            return await selectRandomSfu(registrar, tracks);
        case "fromSchedule":
            return await selectLoadBalancedSfu(registrar, tracks, scheduler, scheduleId, orgId, cookie);
        default:
            console.warn(`Could not find selectionStrategy(${selectionStrategy}), using default`);
            return await selectLoadBalancedSfu(registrar, tracks, scheduler, scheduleId, orgId, cookie);
        }
    } catch(e) {
        console.error(e);
        return;
    }
}


async function selectLoadBalancedSfu(registrar: RedisRegistrar, tracks: TrackInfo[], scheduler: Scheduler, scheduleId: ScheduleId, orgId: OrgId, cookie: string) {
    const roster = await scheduler.getSchedule(scheduleId, orgId, cookie);
    const numStudents = roster.class_roster_students.length;
    const numTeachers = roster.class_roster_teachers.length;
    const sfuIds = tracks.reduce((ids, track) => ids.add(track.sfuId), new Set<SfuId>());
    // It would be ideal to have the user id attached to the track in redis, but until that is implemented we'll assume
    // the remaining tracks is close to 3 * teachers + 2 * students - tracks.length
    const potentialNewTracks  = 3 * numTeachers + 3 * numStudents - tracks.length;
    const potentialNewConsumers = potentialNewTracks * (numStudents + numTeachers);
    let potentialNewLoad = potentialNewTracks + potentialNewConsumers;

    // Of the SFUs serving this room, see if one can handle the remaining load.
    let lowestLoadSfuId;
    let lowestLoad = Infinity;
    let sfuStatuses = await Promise.all(Array.from(sfuIds).map(async sfuId => {
        return {id: sfuId, status: await registrar.getSfuStatus(sfuId) };
    }));

    // If the potential new load is greater than what a single SFU can support, just consider the SFU with the lowest load.
    // This will result in filling up an SFU until the remaining work can be fit on another SFU.
    if (potentialNewLoad >= MAX_SFU_LOAD) {
        potentialNewLoad = 3;
    }

    sfuStatuses = sfuStatuses.filter(sfuStatus => MAX_SFU_LOAD - (sfuStatus.status.producers + sfuStatus.status.consumers) >= potentialNewLoad);

    // Select the SFU with the lowest load.
    for (const sfuStatus of sfuStatuses) {
        const { id, status} = sfuStatus;
        const { consumers, producers } = status;
        if (!lowestLoadSfuId) { lowestLoadSfuId = id; }
        const load = consumers + producers;
        if (load < lowestLoad && load + potentialNewLoad <= MAX_SFU_LOAD) {
            lowestLoad = load;
            lowestLoadSfuId = id;
        }
    }
    if (lowestLoadSfuId) {
        return lowestLoadSfuId;
    }
    // Otherwise, look for an SFU that can handle the remaining load.
    return await registrar.getAvailableSfu(potentialNewLoad);
}

async function selectRandomSfu(registrar: RedisRegistrar, tracks: TrackInfo[]) {
    const ids = tracks.reduce((ids, track) => ids.add(track.sfuId), new Set<SfuId>());
    let randomIndex = 1 + Math.floor(ids.size * Math.random());
    for (const id of ids) {
        if (randomIndex <= 0) { return id; }
        randomIndex--;
    }
    return await registrar.getRandomSfuId();
}
