<script lang="ts">
	import * as Dialog from './index.js';

	let { showCloseButton = true }: { showCloseButton?: boolean } = $props();
</script>

<Dialog.Root open>
	<Dialog.Content {showCloseButton}>
		<!-- eslint-disable-next-line @intlify/svelte/no-raw-text -- test fixture body, never shown to a real user -->
		<p>Dialog harness body</p>
	</Dialog.Content>
</Dialog.Root>
