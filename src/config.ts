export interface SilentGlissConfig {
	address?: string;
	verboseDebug?: boolean;
	autoGroups?: boolean;
	commandApiPort?: number;
	commandApiToken?: string;
}

export interface SilentGlissBlind {
	id: string;
	visible: string;
	error: string;
	move_status: string;
	pos_percent: string;
}
