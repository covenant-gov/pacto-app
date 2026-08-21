// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import PinInput from './PinInput.svelte';

afterEach(() => {
  cleanup();
});

function digitInput(n: number): HTMLInputElement {
  return screen.getByLabelText(`PIN digit ${n}`) as HTMLInputElement;
}

describe('PinInput', () => {
  it('advances focus per digit and fires completion exactly once on the final digit', async () => {
    const onComplete = vi.fn();
    render(PinInput, { title: 'Enter your PIN', onComplete, pinDigitCount: 4 });

    await fireEvent.input(digitInput(1), { target: { value: '1' } });
    expect(document.activeElement).toBe(digitInput(2));
    expect(onComplete).not.toHaveBeenCalled();

    await fireEvent.input(digitInput(2), { target: { value: '2' } });
    expect(document.activeElement).toBe(digitInput(3));
    expect(onComplete).not.toHaveBeenCalled();

    await fireEvent.input(digitInput(3), { target: { value: '3' } });
    expect(document.activeElement).toBe(digitInput(4));
    expect(onComplete).not.toHaveBeenCalled();

    await fireEvent.input(digitInput(4), { target: { value: '4' } });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('1234');
  });

  it('clears every digit exactly once when a new incorrect-PIN error arrives, without looping', async () => {
    const onComplete = vi.fn();
    const { rerender } = render(PinInput, {
      title: 'Enter your PIN',
      onComplete,
      pinDigitCount: 4,
      error: null,
    });

    for (let i = 1; i <= 4; i++) {
      await fireEvent.input(digitInput(i), { target: { value: String(i) } });
    }
    expect(onComplete).toHaveBeenCalledTimes(1);
    for (let i = 1; i <= 4; i++) {
      expect(digitInput(i).value).toBe(String(i));
    }

    // Parent surfaces an incorrect-PIN error after the failed unlock attempt.
    await rerender({ title: 'Enter your PIN', onComplete, pinDigitCount: 4, error: 'Incorrect PIN' });

    await waitFor(() => {
      for (let i = 1; i <= 4; i++) {
        expect(digitInput(i).value).toBe('');
      }
    });
    expect(screen.getByRole('alert').textContent).toBe('Incorrect PIN');

    // Re-rendering with the *same* error must not re-clear or re-shake (sentinel guard).
    const container = screen.getByRole('alert').closest('.pin-input-container') as HTMLElement;
    const pinInputsEl = container.querySelector('.pin-inputs') as HTMLElement;
    await waitFor(() => expect(pinInputsEl.classList.contains('shake')).toBe(false));

    await rerender({ title: 'Enter your PIN', onComplete, pinDigitCount: 4, error: 'Incorrect PIN' });
    expect(pinInputsEl.classList.contains('shake')).toBe(false);
    for (let i = 1; i <= 4; i++) {
      expect(digitInput(i).value).toBe('');
    }
  });
});
