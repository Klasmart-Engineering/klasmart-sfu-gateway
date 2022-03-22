import cookie from "cookie";
import { IncomingMessage } from "http";
import { checkAuthenticationToken, checkLiveAuthorizationToken } from "@kl-engineering/kidsloop-token-validation";
import parseUrl from "parseurl";
import { Url } from "url";
import { newRoomId } from "./redis";
import {newOrgId, newScheduleId} from "./scheduler";
import {Logger} from "./logger";

export async function handleAuth(req: IncomingMessage, url = parseUrl(req)) {
    if (process.env.DISABLE_AUTH) {
        Logger.warn("RUNNING IN DEBUG MODE - SKIPPING AUTHENTICATION AND AUTHORIZATION");
        return {
            userId: debugUserId(),
            roomId: newRoomId("test-room"),
            isTeacher: true,
            orgId: newOrgId("test-org"),
            scheduleId: newScheduleId("test-schedule"),
            authCookie: ""
        };
    }

    const authentication = getAuthenticationJwt(req, url);
    const authorization = getAuthorizationJwt(req, url);

    const authenticationToken = await checkAuthenticationToken(authentication);
    const authorizationToken = await checkLiveAuthorizationToken(authorization);
    if (authorizationToken.userid !== authenticationToken.id) {
        throw new Error("Authentication and Authorization tokens are not for the same user");
    }

    if (!authorizationToken.org_id) {
        throw new Error("Authorization token does not have an org_id");
    }

    if (!authorizationToken.schedule_id) {
        throw new Error("Authorization token does not have a schedule_id");
    }

    return {
        userId: authorizationToken.userid,
        roomId: newRoomId(authorizationToken.roomid),
        isTeacher: authorizationToken.teacher ?? false,
        orgId: newOrgId(authorizationToken.org_id),
        scheduleId: newScheduleId(authorizationToken.schedule_id),
        authCookie: authentication
    };
}

const getAuthenticationJwt = (req: IncomingMessage, url?: Url) => {
    if(url && process.env.NODE_ENV?.toLowerCase().startsWith("dev")) {
        const authentication =  getFromUrl(url, "authentication");
        if(authentication) { return authentication; }
    }

    if (req.headers.cookie) {
        const cookies = cookie.parse(req.headers.cookie);
        const authentication = cookies.access;
        if(authentication) { return authentication; }
    }

    throw new Error("No authentication");
};

const getAuthorizationJwt = (_req: IncomingMessage, url?: Url) => {
    if(url) {
        const authorization =  getFromUrl(url, "authorization");
        if(authorization) { return authorization; }

    }
    throw new Error("No authorization; no authorization query param");
};


export function getFromUrl(url: Url, key: string) {
    if (!url.query) { return; }
    if (typeof url.query === "string") {
        const queryParams = new URLSearchParams(url.query);
        const value = queryParams.get(key);
        return value ?? undefined;
    } else {
        const value = url.query[key];
        return value instanceof Array ? value[0] : value;
    }
}

let _debugUserCount = 0;
function debugUserId() { return `debugUser${_debugUserCount++}`; }
