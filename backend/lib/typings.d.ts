import { ethers } from 'ethers';

export type MakeRpcRequest = (method: string, params: unknown[]) => Promise<unknown>;
export type MakePayloadCidRequest = (providerId:string,pieceCid:string) => Promise<string|null>;
export type GetIndexProviderPeerId = (
    minerId:number,
  ) => Promise<{ peerId: string, source: string }>;