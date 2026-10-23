<script lang="ts">
  import { onDestroy, tick, type ComponentProps } from 'svelte';
  import MessageInput from './MessageInput.svelte';
  import { lastEditableMessage, type MessageEditRequest } from '../../lib/messaging/message-edit';
  import type { DmMessage } from '../../stores/dm';

  type Props = ComponentProps<typeof MessageInput> & {
    messages: DmMessage[];
    /** Includes the virtual channel, since several channels may share a chat id. */
    scope: string;
    editRequest?: MessageEditRequest | null;
  };

  let { messages, scope, editRequest = $bindable(null), ...composerProps }: Props = $props();
  let composer: MessageInput | undefined = $state();

  $effect(() => {
    if (editRequest?.scope !== scope) editRequest = null;
  });

  onDestroy(() => {
    editRequest = null;
  });

  function editLast(): boolean {
    const message = lastEditableMessage(messages);
    if (!message) return false;
    const request: MessageEditRequest = {
      messageId: message.id,
      scope,
      finish: () => {
        if (editRequest?.finish !== request.finish || scope !== request.scope) return;
        editRequest = null;
        void tick().then(() => {
          if (scope === request.scope) composer?.focus();
        });
      },
    };
    editRequest = request;
    return true;
  }
</script>

<MessageInput {...composerProps} bind:this={composer} onEditLast={editLast} />
