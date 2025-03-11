export type MakeRpcRequest = (method: string, params: unknown[]) => Promise<unknown>;
export type MakePayloadCidRequest = (providerId:string,pieceCid:string) => Promise<string|null>;
