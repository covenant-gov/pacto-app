import type { CommonsBroadcastDurationHours } from './broadcast-duration';
export type { CommonsBroadcastDurationHours };

export type CommonsBroadcastSubject = 'user' | 'squad';

export type CommonsBroadcastAudience = 'new_user' | 'active_user';

export interface CommonsSquadPublishInput {
  id: string;
  name: string;
  kind: 'squad' | 'squad-pair';
  iconUrl?: string;
}

export interface CommonsPublishBroadcastInput {
  subject: CommonsBroadcastSubject;
  message: string;
  durationHours: CommonsBroadcastDurationHours;
  tags: string[];
  audience?: CommonsBroadcastAudience | null;
  squad?: CommonsSquadPublishInput;
}

export interface CommonsBroadcastDto {
  eventId: string;
  authorNpub: string;
  subject: CommonsBroadcastSubject;
  subjectId: string;
  message: string;
  durationHours: CommonsBroadcastDurationHours;
  expiresAt: number;
  tags: string[];
  audience?: CommonsBroadcastAudience | null;
  squadId?: string;
  squadName?: string;
  squadKind?: 'squad' | 'squad-pair';
  squadIconUrl?: string;
  createdAt: number;
}

/** Client-side mirror of our own active broadcasts for cooldown UX. */
export interface CommonsBroadcastLocalState {
  subject: CommonsBroadcastSubject;
  subjectId: string;
  eventId: string;
  expiresAt: number;
  durationHours: CommonsBroadcastDurationHours;
  tags: string[];
  message: string;
  audience?: CommonsBroadcastAudience;
}

export type CommonsJoinRequestStatus = 'pending' | 'accepted' | 'rejected';

/** Pending join row materialized from MLS `join_requests` bucket (not public Nostr). */
export interface CommonsJoinRequestDto {
  eventId: string;
  requesterNpub: string;
  squadId: string;
  squadName: string;
  broadcastEventId: string;
  createdAt: number;
  status: CommonsJoinRequestStatus;
  respondedAt?: number;
  responderNpub?: string;
}
