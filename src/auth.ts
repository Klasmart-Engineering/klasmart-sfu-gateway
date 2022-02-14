import cookie from "cookie";
import { IncomingMessage } from "http";
import { checkAuthenticationToken, checkLiveAuthorizationToken } from "kidsloop-token-validation";
import parseUrl from "parseurl";
import { Url } from "url";
import { newRoomId } from "./redis";

export async function handleAuth(req: IncomingMessage, url = parseUrl(req)) {
    if (process.env.DISABLE_AUTH) {
        console.warn("RUNNING IN DEBUG MODE - SKIPPING AUTHENTICATION AND AUTHORIZATION");
        return {
            userId: debugUserId(),
            roomId: newRoomId("test-room"),
            isTeacher: true
        };
    }

    const authentication = getAuthenticationJwt(req, url);
    const authorization = getAuthorizationJwt(req, url);

    const authenticationToken = await checkAuthenticationToken(authentication);
    const authorizationToken = await checkLiveAuthorizationToken(authorization);
    if (authorizationToken.userid !== authenticationToken.id) {
        throw new Error("Authentication and Authorization tokens are not for the same user");
    }

    return {
        userId: authorizationToken.userid,
        roomId: newRoomId(authorizationToken.roomid),
        isTeacher: authorizationToken.teacher || false,
    };
}

const getAuthenticationJwt = (req: IncomingMessage, url?: Url) => {
    if (req.headers.cookie) {
        const cookies = cookie.parse(req.headers.cookie);
        const authentication = cookies.access;
        if(authentication) {return authentication; }
    }

    if(url && process.env.NODE_ENV?.toLowerCase().startsWith("dev")) {
        const authentication =  getFromUrl(url, "authentication");
        if(authentication) {return authentication;}    
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


function getFromUrl(url: Url, key: string) {
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
