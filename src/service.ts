import cookie from "cookie";
import { IncomingMessage } from "http";
import httpProxy from "http-proxy";
import { checkAuthenticationToken, checkLiveAuthorizationToken } from "kidsloop-token-validation";
import { WebSocketServer, WebSocket } from "ws";

import { newRoomId, newSfuId, newUserId, RedisRegistrar, SfuId, TrackInfo, TrackInfoEvent } from "./redis";
import { Server } from "./server";


export function createServer(registrar: RedisRegistrar) {
    const server = new Server();

    server.get("/server-health", (req, res) => {
        res.statusCode = 200;
        res.statusMessage = "Ok";
        res.end();
    });

    const wss = new WebSocketServer({noServer: true});

    server.ws("/room", async (params, socket, req, head) => {
        const { roomId } = await handleAuth(req);
        if (!roomId) { throw new Error("No room RoomId"); }

        const ws = await new Promise<WebSocket>(resolve => wss.handleUpgrade(req, socket, head, resolve)); 
        // ws.addEventListener("message", (e) => console.log(e));

        let currentCursor = `${Date.now()}`;
        {
            const tracks = await registrar.getTracks(roomId);
            const sfuId = await selectSfu(registrar, tracks);
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
    });
    
    const proxy = httpProxy.createProxyServer({});

    server.ws("/sfuid/:sfuId", async (params, socket, req, head) => {
        if (!params["sfuId"]) { throw new Error(`No sfuId found in req.url(${req.url})`); }
        const sfuId = newSfuId(params["sfuId"]);

        const sfuAddress = await registrar.getSfuAddress(sfuId);
        if (!sfuAddress) { throw new Error(`sfu address not found for sfuId("${sfuId}")`); }

        const target = `ws://${sfuAddress}`;
        console.log(`Proxying to target(${target})`);
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

async function selectSfu(registrar: RedisRegistrar, tracks: TrackInfo[]) {
    const ids = tracks.reduce((ids, track) => ids.add(track.sfuId), new Set<SfuId>());
    let randomIndex = 1 + Math.floor(ids.size * Math.random());
    for (const id of ids) {
        if (randomIndex <= 0) { return id; }
        randomIndex--;
    }
    return await registrar.getRandomSfuId();
}


async function handleAuth(req: IncomingMessage) {
    if (process.env.DISABLE_AUTH) {
        console.warn("RUNNING IN DEBUG MODE - SKIPPING AUTHENTICATION AND AUTHORIZATION");
        return {
            userId: debugUserId(),
            roomId: newRoomId("test-room"),
            isTeacher: true,
        };
    }

    if (!req.headers.cookie) { throw new Error("No authentication; no cookies"); }
    const {
        access,
        authorization,
    } = cookie.parse(req.headers.cookie);

    if (!access) { throw new Error("No authentication; no access cookie"); }
    if (!authorization) { throw new Error("No authorization; no authorization cookie"); }

    const authenticationToken = await checkAuthenticationToken(access);
    const authorizationToken = await checkLiveAuthorizationToken(authorization);
    if (authorizationToken.userid !== authenticationToken.id) {
        throw new Error("Authentication and Authorization tokens are not for the same user");
    }

    return {
        userId: newUserId(authorizationToken.userid),
        roomId: newRoomId(authorizationToken.roomid),
        isTeacher: authorizationToken.teacher || false,
    };
}

let _debugUserCount = 0;
function debugUserId() { return newUserId(`debugUser${_debugUserCount++}`); }