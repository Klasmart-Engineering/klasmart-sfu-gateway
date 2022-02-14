import httpProxy from "http-proxy";
import { WebSocketServer, WebSocket } from "ws";
import { handleAuth } from "./auth";
import { newSfuId, RedisRegistrar, SfuId, TrackInfo, TrackInfoEvent } from "./redis";
import { Server } from "./server";

export function createServer(registrar: RedisRegistrar) {
    const server = new Server();

    server.get("/server-health", (req, res) => {
        res.statusCode = 200;
        res.statusMessage = "Ok";
        res.end();
    });

    const wss = new WebSocketServer({noServer: true});

    server.ws("/room", async (params, socket, req, head, url) => {
        try {
            const { roomId } = await handleAuth(req, url);
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

async function selectSfu(registrar: RedisRegistrar, tracks: TrackInfo[]) {
    const ids = tracks.reduce((ids, track) => ids.add(track.sfuId), new Set<SfuId>());
    let randomIndex = 1 + Math.floor(ids.size * Math.random());
    for (const id of ids) {
        if (randomIndex <= 0) { return id; }
        randomIndex--;
    }
    return await registrar.getRandomSfuId();
}
