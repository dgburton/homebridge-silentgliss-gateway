export interface SilentGlissConfig {
	address?: string;
	verboseDebug?: boolean;
	autoGroups?: boolean;
}

export interface SilentGlissBlind {
	id: string;
	visible: string;
	error: string;
	move_status: string;
	pos_percent: string;
}
