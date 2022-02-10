import { createServer, IncomingMessage, ServerResponse } from "http";
import { pathToRegexp, Key } from "path-to-regexp";
import parseUrl from "parseurl";
import { Duplex } from "stream";
import { Url } from "url";

export type Params = Record<string, string | undefined>
export type Handler = (params: Params, res: ServerResponse, req: IncomingMessage, url: Url) => unknown
export type WsHandler = (params: Params, socket: Duplex, req: IncomingMessage, head: Buffer, url: Url) => unknown

export type Route<T> = {
    match: (pathname: string) => Params | undefined,
    handler: T,
}

export class Server {
    public constructor(
        public readonly http = createServer((req, res) => this.onRequest(req, res)),
    ) {
        http.on("upgrade", (req, socket, head) => this.onUpgrade(req, socket, head));
    }

    public async listen(port: number) {
        return await new Promise<void>(resolve => this.http.listen(port, resolve));
    }

    public get(pattern: string, handler: Handler) {
        this.getRoutes.push(createRoute(pattern, handler));
    }

    public ws(pattern: string, handler: WsHandler) {
        this.wsRoutes.push(createRoute(pattern, handler));
    }

    private getRoutes: Route<Handler>[] = [];
    private onRequest(req: IncomingMessage, res: ServerResponse) {
        const route = matchRoute(this.getRoutes, req);

        if(!route) { return errorResponse(res, 404); }
        route.handler(route.params, res, req, route.url);

        if(!res.writableEnded) { return errorResponse(res, 500); }

        return errorResponse(res, 404);
    }

    private wsRoutes: Route<WsHandler>[] = [];
    private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
        const route = matchRoute(this.wsRoutes, req);
        if(!route) { return socket.end(); }

        route.handler(route.params, socket, req, head, route.url);
        return;
    }
}

function createRoute<T>(pattern: string, handler: T): Route<T> {
    const keys: Key[] = [];
    const regex = pathToRegexp(pattern, keys);
    return {
        match: (pathname) => {
            const match = regex.exec(pathname);
            if (!match) { return; }
            const params: Params = {};
            keys.forEach(({ name }, i) => { params[name] = match[i + 1]; });
            return params;
        },
        handler,
    };
}

function matchRoute<T>(routes: Route<T>[], req: IncomingMessage) {
    const url = parseUrl(req);
    if(!url) { return; }

    const pathname = url.pathname ?? undefined;
    if (!pathname) { return; }

    for (const { match, handler } of routes) {
        const params = match(pathname);
        if (params) { return { url, handler, params }; }
    }
    return;
}

function errorResponse(res: ServerResponse, statusCode?: number, statusMessage?: string) {
    if(statusCode !== undefined) { res.statusCode = statusCode; }
    if(statusMessage !== undefined) { res.statusMessage = statusMessage; }
    res.end();
}
