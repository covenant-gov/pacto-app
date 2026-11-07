// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import EventCivilDateTimeInput from './EventCivilDateTimeInput.svelte';

afterEach(cleanup);

it('edits midnight and noon as 12 AM and 12 PM without changing the date', async () => {
  const oninput = vi.fn();
  const view = render(EventCivilDateTimeInput, { id: 'start', label: 'Starts', value: '2026-12-01T00:15', clockFormat: '12h', oninput });
  expect((screen.getByLabelText('Starts: Hour') as HTMLInputElement).value).toBe('12');
  expect((screen.getByLabelText('Starts: AM/PM') as HTMLSelectElement).value).toBe('AM');
  await fireEvent.change(screen.getByLabelText('Starts: AM/PM'), { target: { value: 'PM' } });
  expect(oninput).toHaveBeenLastCalledWith('2026-12-01T12:15');
  await view.rerender({ value: '2026-12-01T12:15', clockFormat: '24h' });
  expect((screen.getByLabelText('Starts: Hour') as HTMLInputElement).value).toBe('12');
  expect(screen.queryByLabelText('Starts: AM/PM')).toBeNull();
  await fireEvent.input(screen.getByLabelText('Starts: Hour'), { target: { value: '0' } });
  expect(oninput).toHaveBeenLastCalledWith('2026-12-01T00:15');
});

it('clears an optional end and leaves incomplete or invalid clock input for validation', async () => {
  const oninput = vi.fn();
  render(EventCivilDateTimeInput, { id: 'end', label: 'Ends', value: '2026-12-02T13:30', clockFormat: '12h', oninput });
  await fireEvent.input(screen.getByLabelText('Ends: Hour'), { target: { value: '' } });
  expect(oninput).toHaveBeenLastCalledWith('2026-12-02T:30');
  await fireEvent.input(screen.getByLabelText('Ends: Hour'), { target: { value: '13' } });
  expect(oninput).toHaveBeenLastCalledWith('2026-12-02Tinvalid:30');
  await fireEvent.input(screen.getByLabelText('Ends: Date'), { target: { value: '' } });
  expect(oninput).toHaveBeenLastCalledWith('');
});

it('applies an external value even when it matches a previously emitted clock edit', async () => {
  const oninput = vi.fn();
  const view = render(EventCivilDateTimeInput, { id: 'end', label: 'Ends', value: '2026-12-01T10:00', clockFormat: '24h', oninput });
  await fireEvent.input(screen.getByLabelText('Ends: Hour'), { target: { value: '11' } });
  expect(oninput).toHaveBeenLastCalledWith('2026-12-01T11:00');
  await view.rerender({ value: '2026-12-01T11:00' });
  await view.rerender({ value: '2026-12-01T12:00' });
  expect((screen.getByLabelText('Ends: Hour') as HTMLInputElement).value).toBe('12');
  await view.rerender({ value: '2026-12-01T11:00' });
  expect((screen.getByLabelText('Ends: Hour') as HTMLInputElement).value).toBe('11');
});
