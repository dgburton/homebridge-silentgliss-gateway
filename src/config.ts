export interface SilentGlissConfig {
		address?: string;
    username?: string;
    password?: string;
    closeUp?: boolean;
    allowDebug?: boolean;
    statusLog?: boolean;
    pollingInterval?: number;
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
