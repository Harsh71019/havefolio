import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  DateInput,
  displayToIso,
  isoToDisplay,
} from '@havefolio/ui/components/havefolio/date-input';

function Controlled({
  initial = '',
  spy,
}: {
  initial?: string;
  spy: (v: string) => void;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="d">Date</label>
      <DateInput
        id="d"
        value={value}
        onChange={(next) => {
          spy(next);
          setValue(next);
        }}
      />
      <button type="button" onClick={() => setValue('2020-01-31')}>
        Reset
      </button>
    </>
  );
}

describe('DD/MM/YYYY date input', () => {
  it('converts between ISO and day-first text, rejecting impossible dates', () => {
    expect(isoToDisplay('2024-03-15')).toBe('15/03/2024');
    expect(isoToDisplay('')).toBe('');
    expect(displayToIso('15/03/2024')).toBe('2024-03-15');
    expect(displayToIso('29/02/2024')).toBe('2024-02-29');
    expect(displayToIso('29/02/2023')).toBeUndefined();
    expect(displayToIso('31/04/2024')).toBeUndefined();
    expect(displayToIso('15/13/2024')).toBeUndefined();
    expect(displayToIso('00/01/2024')).toBeUndefined();
    expect(displayToIso('15/03/24')).toBeUndefined();
  });

  it('inserts separators while typing and emits ISO only for a complete real date', async () => {
    const spy = vi.fn();
    render(<Controlled spy={spy} />);
    const input = screen.getByLabelText('Date');
    expect(input).toHaveAttribute('placeholder', 'DD/MM/YYYY');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    await userEvent.type(input, '1503');
    expect(input).toHaveValue('15/03');
    // Partial text is passed through so the form's own validation rejects it.
    expect(spy).toHaveBeenLastCalledWith('15/03');
    await userEvent.type(input, '2024');
    expect(input).toHaveValue('15/03/2024');
    expect(spy).toHaveBeenLastCalledWith('2024-03-15');
    await userEvent.type(input, '{Backspace}');
    expect(input).toHaveValue('15/03/202');
    await userEvent.clear(input);
    expect(spy).toHaveBeenLastCalledWith('');
    await userEvent.type(input, '31022024');
    expect(spy).toHaveBeenLastCalledWith('31/02/2024');
  });

  it('shows an existing value day-first, accepts pasted ISO and follows outside resets', async () => {
    const spy = vi.fn();
    render(<Controlled initial="2023-07-04" spy={spy} />);
    const input = screen.getByLabelText('Date');
    expect(input).toHaveValue('04/07/2023');
    fireEvent.change(input, { target: { value: '2024-02-29' } });
    expect(input).toHaveValue('29/02/2024');
    expect(spy).toHaveBeenLastCalledWith('2024-02-29');
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(input).toHaveValue('31/01/2020');
  });

  it('submits the ISO value under its name and keeps the calendar picker in sync', () => {
    const { container } = render(
      <form>
        <DateInput aria-label="From" name="from" defaultValue="2024-02-01" max="2024-12-31" />
      </form>,
    );
    const form = container.querySelector('form')!;
    expect(new FormData(form).get('from')).toBe('2024-02-01');
    const picker = container.querySelector('input[type="date"]')!;
    expect(picker).toHaveAttribute('aria-hidden', 'true');
    expect(picker).toHaveAttribute('max', '2024-12-31');
    expect(picker).toHaveValue('2024-02-01');
    fireEvent.change(picker, { target: { value: '2024-06-09' } });
    expect(screen.getByLabelText('From')).toHaveValue('09/06/2024');
    expect(new FormData(form).get('from')).toBe('2024-06-09');
    expect(screen.getByRole('button', { name: 'Choose from calendar' })).toBeVisible();
  });
});
