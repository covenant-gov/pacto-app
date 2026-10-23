// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ChatView from './ChatView.svelte';
import {
  activeChannelId, activeHubChannelName, activeSquadId, activeTopNavTab,
  backendGroupMessages, squads, type Squad,
} from '../../stores/app';
import type { DmMessage } from '../../stores/dm';
import { buildMentionEnvelope } from '../../lib/messaging/mentions';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((command: string) => Promise.resolve(command === 'list_dashboard_polls' ? [] : true)),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: vi.fn().mockResolvedValue(() => {}) }),
}));

function own(id: string, content: string, at = Date.now()): DmMessage {
  return { id, content, at, mine: true };
}

afterEach(() => {
  cleanup();
  activeChannelId.set(null);
  activeHubChannelName.set(null);
  activeSquadId.set(null);
  squads.set([]);
  backendGroupMessages.set({});
});

describe('ChatView Up Arrow editing', () => {
  it('selects only visible virtual-channel text and closes the editor when the channel changes', async () => {
    const recent = own('shared-message', 'Visible announcement text', Date.now() - 2000);
    activeTopNavTab.set('squads');
    activeSquadId.set('squad');
    squads.set([{
      id: 'squad', name: 'Test squad', channels: [
        { name: 'announcements', groupId: 'shared-group', order: 0 },
        { name: 'polls', groupId: 'shared-group', order: 1 },
        { name: 'general', groupId: 'other-group', order: 2 },
      ],
    } as Squad]);
    backendGroupMessages.set({
      'shared-group': [recent, own('hidden', buildMentionEnvelope('hidden inbox text', [], 'inbox'))],
      'other-group': [own('shared-message', 'Other channel text')],
    });
    activeChannelId.set('shared-group');
    activeHubChannelName.set('announcements');
    render(ChatView);

    const composer = screen.getByPlaceholderText('Message #announcements');
    await fireEvent.keyDown(composer, { key: 'ArrowUp' });
    const editor = await screen.findByRole('textbox', { name: 'Edit message' });
    expect((editor as HTMLTextAreaElement).value).toBe('Visible announcement text');
    await waitFor(() => expect(document.activeElement).toBe(editor));
    await fireEvent.keyDown(editor, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(composer));
    await fireEvent.keyDown(composer, { key: 'ArrowUp' });
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toBeTruthy();

    activeHubChannelName.set('polls');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull());
    activeHubChannelName.set('announcements');
    await waitFor(() => expect(screen.getByPlaceholderText('Message #announcements')).toBeTruthy());
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();

    activeChannelId.set('other-group');
    activeHubChannelName.set('general');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull());
    await fireEvent.keyDown(screen.getByPlaceholderText('Message #general'), { key: 'ArrowUp' });
    expect((await screen.findByRole('textbox', { name: 'Edit message' }) as HTMLTextAreaElement).value).toBe('Other channel text');
  });
});
