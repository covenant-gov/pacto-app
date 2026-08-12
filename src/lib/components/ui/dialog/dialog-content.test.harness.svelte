<script lang="ts">
	import * as Dialog from './index.js';

	let { showCloseButton = true }: { showCloseButton?: boolean } = $props();
</script>

<Dialog.Root open>
	<Dialog.Content {showCloseButton}>
		<p>Dialog harness body</p>
	</Dialog.Content>
</Dialog.Root>
