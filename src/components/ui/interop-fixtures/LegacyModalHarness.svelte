<svelte:options runes={false} />

<script lang="ts">
  /** Legacy-mode parent passing default slot content into runes-mode Modal. */
  import Modal from '../Modal.svelte';

  export let message: string;
</script>

<Modal titleId="t" onClose={() => {}}>
  <p data-testid="modal-content">{message}</p>
</Modal>
