export interface SilentGlissConfig {
		address?: string;
    verboseDebug?: boolean;
}

export interface MySmartBlindsAuth {
    username: string;
    password: string;
}

export interface MySmartBlindsBlind {
    name: string;
    encodedMacAddress: string;
    encodedPasskey: string;
    roomId: number;
    deleted: boolean;
}
