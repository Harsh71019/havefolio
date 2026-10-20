'use client';
import { CalendarIcon } from 'lucide-react';
import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Input } from '#components/input';
import { cn } from '#lib/utils';

const isoPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`; anything else is shown as given. */
export function isoToDisplay(value: string): string {
  const match = isoPattern.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** Keep digits only and insert the separators as the owner types. */
function formatTyped(raw: string): string {
  // A pasted or autofilled ISO date is accepted as-is.
  if (isoPattern.test(raw.trim())) return isoToDisplay(raw.trim());
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}

/** `DD/MM/YYYY` → `YYYY-MM-DD` for a real calendar date, otherwise undefined. */
export function displayToIso(text: string): string | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return undefined;
  const [, dd, mm, yyyy] = match;
  return isRealDate(Number(yyyy), Number(mm), Number(dd)) ? `${yyyy}-${mm}-${dd}` : undefined;
}

export type DateInputProps = Omit<
  ComponentProps<'input'>,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max'
> & {
  /**
   * `YYYY-MM-DD` once a complete, real date is entered; empty when cleared; otherwise the typed
   * text, so the caller's own date validation rejects a partial or impossible date.
   */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** `YYYY-MM-DD` bounds for the calendar picker; callers still validate ranges. */
  min?: string;
  max?: string;
  pickerLabel?: string;
};

/**
 * PER-68: a DD/MM/YYYY date field. Native date inputs follow the browser locale (often
 * MM/DD/YYYY), so this types and shows day-first while keeping ISO values for forms and APIs.
 * The calendar button still opens the platform's native picker.
 */
export function DateInput({
  className,
  defaultValue,
  disabled,
  max,
  min,
  name,
  onChange,
  pickerLabel = 'Choose from calendar',
  value,
  ...props
}: DateInputProps): ReactNode {
  const controlled = value !== undefined;
  const initial = (controlled ? value : defaultValue) ?? '';
  const [text, setText] = useState(() => isoToDisplay(initial));
  const [emitted, setEmitted] = useState(initial);
  const [inner, setInner] = useState(initial);
  // An outside change (reset, another record) replaces what is shown.
  if (controlled && value !== emitted) {
    setEmitted(value);
    setText(isoToDisplay(value));
  }
  const current = controlled ? value : inner;
  const picker = useRef<HTMLInputElement>(null);

  const commit = (nextText: string): void => {
    const next = nextText ? (displayToIso(nextText) ?? nextText) : '';
    setText(nextText);
    setEmitted(next);
    setInner(next);
    onChange?.(next);
  };

  const openPicker = (): void => {
    const input = picker.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.click();
    }
  };

  return (
    <div className={cn('relative min-h-11', className)}>
      <Input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        maxLength={10}
        disabled={disabled}
        value={text}
        onChange={(event) => commit(formatTyped(event.target.value))}
        className="h-full min-h-11 pr-11 text-base md:text-sm"
      />
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <button
        type="button"
        aria-label={pickerLabel}
        disabled={disabled}
        onClick={openPicker}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
      >
        <CalendarIcon aria-hidden="true" className="size-4" />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        min={min}
        max={max}
        value={isoPattern.test(current) ? current : ''}
        onChange={(event) => commit(isoToDisplay(event.target.value))}
        className="pointer-events-none absolute right-0 bottom-0 size-px opacity-0"
      />
    </div>
  );
}
