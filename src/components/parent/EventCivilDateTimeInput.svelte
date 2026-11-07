<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { EventClockFormat } from '../../stores/event-time-format';

  interface Props {
    id: string;
    label: string;
    value: string;
    clockFormat: EventClockFormat;
    disabled?: boolean;
    invalid?: boolean;
    describedby?: string;
    oninput: (value: string) => void;
  }
  let { id, label, value, clockFormat, disabled = false, invalid = false, describedby, oninput }: Props = $props();
  let date = $state('');
  let hour = $state('');
  let minute = $state('');
  let period = $state('AM');
  let lastEmitted: string | null = null;
  let lastFormat: EventClockFormat | null = null;
  $effect(() => {
    if (value === lastEmitted && clockFormat === lastFormat) return;
    lastEmitted = null;
    const [day = '', time = ''] = value.split('T');
    const [h = '', m = ''] = time.split(':');
    date = day;
    hour = h === '' ? '' : clockFormat === '12h' ? String(Number(h) % 12 || 12) : h;
    minute = m;
    period = Number(h) >= 12 ? 'PM' : 'AM';
    lastFormat = clockFormat;
  });

  function emit() {
    let h = hour;
    if (clockFormat === '12h' && /^\d+$/.test(h) && Number(h) >= 1 && Number(h) <= 12) {
      h = String(Number(h) % 12 + (period === 'PM' ? 12 : 0));
    } else if (clockFormat === '12h' && h !== '') {
      h = 'invalid';
    }
    const next = date ? `${date}T${h ? h.padStart(2, '0') : ''}:${minute ? minute.padStart(2, '0') : ''}` : '';
    lastEmitted = next;
    lastFormat = clockFormat;
    oninput(next);
  }
</script>

{#if clockFormat === 'system'}
  <input {id} type="datetime-local" {value} {disabled} aria-label={label} aria-invalid={invalid || undefined} aria-describedby={describedby} oninput={(e) => oninput(e.currentTarget.value)} />
{:else}
  <fieldset class="civil-input" aria-label={label} aria-describedby={describedby} {disabled}>
    <label class="date-field" for={id}>
      <span>{$t('events.create.dateLabel')}</span>
      <input {id} type="date" value={date} aria-label={`${label}: ${$t('events.create.dateLabel')}`} aria-invalid={invalid || undefined} oninput={(e) => { date = e.currentTarget.value; if (!hour) hour = clockFormat === '12h' ? '12' : '00'; if (!minute) minute = '00'; emit(); }} />
    </label>
    <div class="clock-fields">
      <label for={`${id}-hour`}><span>{$t('events.create.hourLabel')}</span><input id={`${id}-hour`} type="number" min={clockFormat === '12h' ? 1 : 0} max={clockFormat === '12h' ? 12 : 23} step="1" inputmode="numeric" value={hour} aria-label={`${label}: ${$t('events.create.hourLabel')}`} aria-invalid={invalid || undefined} oninput={(e) => { hour = e.currentTarget.value; emit(); }} /></label>
      <label for={`${id}-minute`}><span>{$t('events.create.minuteLabel')}</span><input id={`${id}-minute`} type="number" min="0" max="59" step="1" inputmode="numeric" value={minute} aria-label={`${label}: ${$t('events.create.minuteLabel')}`} aria-invalid={invalid || undefined} oninput={(e) => { minute = e.currentTarget.value; emit(); }} /></label>
      {#if clockFormat === '12h'}
        <label for={`${id}-period`}><span>{$t('events.create.periodLabel')}</span><select id={`${id}-period`} value={period} aria-label={`${label}: ${$t('events.create.periodLabel')}`} onchange={(e) => { period = e.currentTarget.value; emit(); }}><option value="AM">{$t('events.create.periodAM')}</option><option value="PM">{$t('events.create.periodPM')}</option></select></label>
      {/if}
    </div>
  </fieldset>
{/if}

<style>
  .civil-input { border: 0; padding: 0; margin: 0; min-width: 0; }
  .clock-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 6px; }
  .clock-fields label, .date-field { display: block; min-width: 0; }
  span { display: block; color: var(--text-secondary); font-size: 0.75rem; margin-bottom: 4px; }
  input, select { width: 100%; min-width: 0; box-sizing: border-box; padding: 10px 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-panel); color: var(--text-primary); font: inherit; font-variant-numeric: tabular-nums; }
  input:focus-visible, select:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
</style>
