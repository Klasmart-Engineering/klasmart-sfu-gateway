import httpProxy from "http-proxy";
import {RawData, WebSocket, WebSocketServer} from "ws";
import {handleAuth} from "./auth";
import {newSfuId, RedisRegistrar, RoomId, SfuId, TrackInfoEvent} from "./redis";
import {Server} from "./server";
import {IScheduler, OrgId, ScheduleId, Scheduler} from "./scheduler";
import {selectSfu} from "./selectSfu";
import {Url} from "url";
import {Logger} from "./logger";

export function getEnvNumber(envVar: string | undefined, defaultValue: number): number {
    if (envVar) {
        const parsedInt = parseInt(envVar);
        if (!isNaN(parsedInt)) {
            return parsedInt;
        }
    }
    Logger.warn(`Invalid value: ${envVar}, using default value ${defaultValue}`);
    return defaultValue;
}

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
            ws.on("message", (m) => onMessage(m, registrar, url, scheduler, scheduleId, orgId, authCookie, roomId, ws));
            {
                try {
                    const tracks = await registrar.getTracks(roomId);
                    const sfuId = await selectSfu(url, registrar, tracks, scheduler, scheduleId, orgId, authCookie);
                    Logger.info(`Sending sfuId(${sfuId})`);
                    const trackEvents = [
                        ...tracks.map<TrackInfoEvent>(add => ({ add })),
                    ];
                    ws.send(JSON.stringify([{ sfuId }]));
                    ws.send(JSON.stringify(trackEvents));
                } catch (e) {
                    Logger.error(e);
                    const error = <Error> e;
                    ws.send(JSON.stringify([{ error: error.message }]));
                }
            }

            while (ws.readyState === WebSocket.OPEN) {
                const { cursor, events } = await registrar.waitForTrackChanges(roomId, currentCursor);
                if (events) { ws.send(JSON.stringify(events)); }
                currentCursor = cursor;
            }
        } catch(e) {
            Logger.error(e);
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

        Logger.info(`Proxying to sfu(${sfuId}) at '${sfuAddress}' for [${req.socket.remoteFamily}](${req.socket.remoteAddress}:${req.socket.remotePort})`);
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
            Logger.info(`Proxying to target(${target})`);
            proxy.ws(req, socket, head, { target, ignorePath: true });
        } catch (e) {
            Logger.error(e);
            socket.end();
        }
    });

    return server;
}

async function onMessage(message: RawData, registrar: RedisRegistrar, url: Url, scheduler: IScheduler, scheduleId: ScheduleId, orgId: OrgId, authCookie: string, roomId: RoomId, ws: WebSocket) {
    // In future this could (should?) be expanded to handle multiple request types
    try {
        if (message.toString().length === 0) return;
        const request = parse(message);
        const tracks = await registrar.getTracks(roomId);
        const sfuId = await selectSfu(url, registrar, tracks, scheduler, scheduleId, orgId, authCookie, request?.excludeId);
        Logger.info(`Sending sfuId(${sfuId})`);
        const trackEvents = [
            ...tracks.map<TrackInfoEvent>(add => ({ add })),
        ];
        ws.send(JSON.stringify([{ sfuId }]));
        ws.send(JSON.stringify(trackEvents));
    } catch (e) {
        Logger.error(`Error: ${e}`);
        const error = <Error> e;
        ws.send(JSON.stringify({ error: error.message }));
    }
}

function parse(message: RawData) {
    const request = message.toString();
    if (request.length > 0) {
        return JSON.parse(message.toString()) as ClientRequest;
    }
    return;
}

export type ClientRequest = {
    excludeId?: SfuId
}
