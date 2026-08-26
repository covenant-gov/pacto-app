import type { Snippet } from 'svelte';

export type ShellPreviewState = 'default' | 'loading' | 'empty' | 'error' | 'dense' | 'long';

export type ShellPresence = 'online' | 'away' | 'busy' | 'offline';

export type ShellLensKind = 'chat' | 'dashboard' | 'governance';

export type ShellChannelKind = 'text' | 'private' | 'announcement';

export interface ShellSquad {
	id: string;
	name: string;
	initials: string;
	unreadCount?: number;
}

export interface ShellLens {
	id: string;
	label: string;
	kind: ShellLensKind;
}

export interface ShellChannel {
	id: string;
	name: string;
	groupId: string;
	groupLabel: string;
	kind: ShellChannelKind;
	unread?: boolean;
	mentionCount?: number;
}

export interface ShellMember {
	id: string;
	name: string;
	initials: string;
	role: string;
	presence: ShellPresence;
	status: string;
	isCurrentUser?: boolean;
}

export interface AppShellLabels {
	main: string;
	openSidebar: string;
	openAside: string;
	closeSidebar: string;
	closeAside: string;
	sidebarDrawer: string;
	asideDrawer: string;
}

export interface AppShellRegions {
	rail: Snippet;
	sidebar: Snippet;
	main: Snippet;
	aside?: Snippet;
}

export interface NavRailLabels {
	navigation: string;
	selectLens: (label: string) => string;
	selectSquad: (name: string) => string;
	unreadCount: (count: number) => string;
}

export interface ChannelSidebarLabels {
	navigation: string;
	search: string;
	searchPlaceholder: string;
	empty: string;
	selectChannel: (name: string) => string;
	unread: string;
	mentions: (count: number) => string;
}

export interface ChatFrameLabels {
	region: string;
	loading: string;
	emptyTitle: string;
	emptyBody: string;
	errorTitle: string;
	errorBody: string;
	retry: string;
}

export interface MemberSidebarLabels {
	region: string;
	members: string;
	empty: string;
	currentUser: string;
	selectMember: (name: string) => string;
	presence: Record<ShellPresence, string>;
}

export type ShellSelectCallback = (id: string) => void;

export type ShellRetryCallback = () => void;
