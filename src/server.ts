import { createServer, IncomingMessage, ServerResponse } from "http";
import { pathToRegexp, Key } from "path-to-regexp";
import parseUrl from "parseurl";
import { Duplex } from "stream";

export type Params = Record<string, string | undefined>
export type Handler = (params: Params, res: ServerResponse, req: IncomingMessage) => unknown
export type WsHandler = (params: Params, socket: Duplex, req: IncomingMessage, head: Buffer) => unknown

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
        const pathname = parseUrl(req)?.pathname;
        if (pathname && req.method === "GET") {
            for (const { match, handler } of this.getRoutes) {
                const params = match(pathname);
                if (params) {
                    handler(params, res, req);
                    break;
                }
            }
        }

        res.statusCode = 404;
        res.end();
        return;
    }

    private wsRoutes: Route<WsHandler>[] = [];
    private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
        const pathname = parseUrl(req)?.pathname;
        if (pathname) {
            for (const { match, handler } of this.wsRoutes) {
                const params = match(pathname);
                if (params) {
                    handler(params, socket, req, head);
                    break;
                }
            }
        }

        socket.end();
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


