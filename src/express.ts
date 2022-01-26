import cookie from "cookie";
import express from 'express';
import ws from 'express-ws'
import { IncomingMessage } from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { checkAuthenticationToken, checkLiveAuthorizationToken } from "kidsloop-token-validation";
import WebSocket from 'ws'

import { RedisRegistrar, SfuId, TrackInfo, TrackInfoEvent } from './redis';


export function createExpressServer(registrar: RedisRegistrar) {
    const app = ws(express()).app;

    app.get("/server-health", (req, res) => res.status(200));
    
    app.ws("/room", async (ws, req) => {
        console.log(req.url);
        ws.addEventListener("message", (e) => console.log(e))
        const { roomId } = await handleAuth(req);
        if(!roomId) { throw new Error(`No room RoomId`); }

        let currentCursor = `${Date.now()}`
        {
            const tracks = await registrar.getTracks(roomId)
            const sfuId = await selectSfu(registrar, tracks);
            const initialEvents = [
                {sfuId},
                ...tracks.map<TrackInfoEvent>(add => ({add})),
            ]
            console.log(initialEvents);
            ws.send(JSON.stringify(initialEvents))
        }
        
        while(ws.readyState === WebSocket.OPEN) {
            const { cursor, events } = await registrar.waitForTrackChanges(roomId, currentCursor);
            if(events) { ws.send(JSON.stringify(events)); }
            currentCursor = cursor;
        }
    });

    app.use("/sfuid/:sfuId", createProxyMiddleware({
        ws: true,
        router: async (req) => {
            try {
                console.log(req.url)
                const sfuId = req.params["sfuId"]
                if(!sfuId) { throw new Error(`No sfuId found in req.url("${req.url}")`); }
                
                const sfuAddress = await registrar.getSfuAddress(sfuId)
                if(!sfuAddress) { throw new Error(`sfu address not found for sfuId("${sfuId}")`);}
                
                const url = `ws://${sfuAddress}`
                console.log(`Proxying to target: ${url}`)
                return url
            } catch(e) {
                console.error(e)
                return
            }
        }
    }));

    /* Legacy behavior for sfu v1 */
    app.use("/sfu/:roomId", createProxyMiddleware({
        ws: true,
        router: async (req) => {
            try {
                const roomId = req.params["roomId"]
                if(!roomId) { throw new Error(`No roomId found in req.url("${req.url}")`); }
                
                const sfuAddress = await registrar.getLegacySfuAddressByRoomId(roomId)
                if(!sfuAddress) { throw new Error(`Legacy sfu address not found for roomid("${roomId}")`); }
                
                const url = `ws://${sfuAddress}`
                console.log(`Proxying to target: ${url}`)
                return url
            } catch(e) {
                console.error(e)
                return
            }
        },
    }));

    return app;
}

async function selectSfu(registrar: RedisRegistrar, tracks: TrackInfo[]) {
    const ids = tracks.reduce((ids,track) => ids.add(track.sfuId), new Set<SfuId>())
    let randomIndex = 1 + Math.floor(ids.size*Math.random())
    for(const id of ids) {
        if(randomIndex <= 0) {return id;}
        randomIndex--;
    }
    return await registrar.getRandomSfuId();
}


async function handleAuth(req: IncomingMessage) {
    if(process.env.DISABLE_AUTH) {
        console.warn("RUNNING IN DEBUG MODE - SKIPPING AUTHENTICATION AND AUTHORIZATION");
        return {
            userId: debugUserId(),
            roomId: "test-room",
            isTeacher: true
        };
    }

    if(!req.headers.cookie) { throw new Error("No authentication; no cookies"); }
    const {
        access,
        authorization,
    } = cookie.parse(req.headers.cookie);

    if(!access) { throw new Error("No authentication; no access cookie"); }
    if(!authorization) { throw new Error("No authorization; no authorization cookie"); }

    const authenticationToken = await checkAuthenticationToken(access);
    const authorizationToken = await checkLiveAuthorizationToken(authorization);
    if (authorizationToken.userid !== authenticationToken.id) {
        throw new Error("Authentication and Authorization tokens are not for the same user");
    }

    return {
        userId: authorizationToken.userid,
        roomId: authorizationToken.roomid,
        isTeacher: authorizationToken.teacher || false,
    };
}

let _debugUserCount = 0;
function debugUserId() { return `debugUser${_debugUserCount++}`; }