import type { Container } from '../container';
export interface DevServerOptions {
    root?: string;
    port?: number;
    middleware?: (req: Request) => Promise<Response | undefined> | Response | undefined;
}
export interface DevServerHandle {
    url: string;
    port: number;
    close(): void;
}
export declare function createDevServer(c: Container, o?: DevServerOptions): Promise<DevServerHandle>;
