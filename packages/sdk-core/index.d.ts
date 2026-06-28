export class UsefulWaitingApiError extends Error { status:number; code?:string; eligibility?:Record<string,unknown>; }
export class PendingAdjudicationError extends UsefulWaitingApiError {}
export class GenLayerNotConfiguredError extends UsefulWaitingApiError {}
export class GenLayerRequestFailedError extends UsefulWaitingApiError {}
export class UsefulWaitingClient { constructor(options?:{baseUrl?:string;apiKey?:string;timeoutMs?:number;fetchImpl?:typeof fetch}); request(path:string, options?:{method?:string;body?:unknown;allowedStatuses?:number[]}):Promise<{status:number;body:any}>; health():Promise<any>; }
export function redactApiKey(value?:string):string|null;
