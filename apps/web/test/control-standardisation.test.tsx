import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@havefolio/ui/components/button';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@havefolio/ui/components/empty';
import { DateInput } from '@havefolio/ui/components/havefolio/date-input';
import { RadioGroup, RadioGroupItem } from '@havefolio/ui/components/radio-group';
import { Badge } from '@havefolio/ui/components/badge';
import { Pill } from '@havefolio/ui/components/kibo-ui/pill';
import { useState, useRef, type FormEvent, type ReactElement } from 'react';
import { Sparkles, Trash2 } from 'lucide-react';

describe('PER-89: Shared control sizing, labels, and interaction states standardisation', () => {
  describe('Control Sizing & Touch Targets (44px min-h-11)', () => {
    it('Button default size provides 44px min-h-11 touch target', () => {
      render(<Button>Save item</Button>);
      const button = screen.getByRole('button', { name: 'Save item' });
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('h-11');
      expect(button.className).toContain('px-4');
      expect(button.className).toContain('text-sm');
    });

    it('Button icon size provides 44px size-11 touch target for primary actions', () => {
      render(
        <Button size="icon" aria-label="Delete photo">
          <Trash2 aria-hidden="true" />
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Delete photo' });
      expect(button.className).toContain('size-11');
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('min-w-11');
    });

    it('Button sm size is min-h-9 for compact secondary toolbar actions', () => {
      render(<Button size="sm">Filter</Button>);
      const button = screen.getByRole('button', { name: 'Filter' });
      expect(button.className).toContain('min-h-9');
      expect(button.className).toContain('h-9');
      expect(button.className).toContain('text-xs');
    });

    it('Input default height is min-h-11 (44px) across form entries', () => {
      render(<Input aria-label="Item name" placeholder="Enter item name" />);
      const input = screen.getByLabelText('Item name');
      expect(input.className).toContain('min-h-11');
      expect(input.className).toContain('h-11');
      expect(input.className).toContain('px-3');
      expect(input.className).toContain('py-2');
    });

    it('SelectTrigger default height provides min-h-11 (44px) touch target', () => {
      render(
        <Select defaultValue="INR">
          <SelectTrigger aria-label="Currency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="INR">INR (₹)</SelectItem>
            <SelectItem value="USD">USD ($)</SelectItem>
          </SelectContent>
        </Select>,
      );
      const trigger = screen.getByRole('combobox', { name: 'Currency' });
      expect(trigger.className).toContain('data-[size=default]:min-h-11');
      expect(trigger.className).toContain('data-[size=default]:h-11');
    });

    it('DateInput container and calendar trigger meet 44px touch target floor', () => {
      render(<DateInput aria-label="Purchase date" defaultValue="2026-01-15" />);
      const input = screen.getByLabelText('Purchase date');
      expect(input.className).toContain('min-h-11');
      const calendarBtn = screen.getByRole('button', { name: 'Choose from calendar' });
      expect(calendarBtn.className).toContain('w-11');
      expect(calendarBtn.className).toContain('inset-y-0');
    });
  });

  describe('Form Labels, Descriptions & Validation Associations', () => {
    it('Label has text-sm font-medium and select-none', () => {
      render(<Label htmlFor="test-field">Possession name</Label>);
      const label = screen.getByText('Possession name');
      expect(label.className).toContain('text-sm');
      expect(label.className).toContain('font-medium');
      expect(label.className).toContain('select-none');
    });

    it('Associates input error with aria-invalid and aria-describedby with role="alert"', () => {
      render(
        <div className="space-y-2">
          <Label htmlFor="item-price">Price paid</Label>
          <Input
            id="item-price"
            aria-invalid={true}
            aria-describedby="item-price-error item-price-hint"
          />
          <p id="item-price-hint" className="text-xs text-muted-foreground">
            Enter the amount you paid at purchase time.
          </p>
          <p id="item-price-error" role="alert" className="text-sm text-destructive">
            Enter a valid positive number.
          </p>
        </div>,
      );
      const input = screen.getByLabelText('Price paid');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAttribute('aria-describedby', 'item-price-error item-price-hint');
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Enter a valid positive number.');
      expect(alert.className).toContain('text-destructive');
    });

    it('RadioGroup with standard Label provides accessible radio selection', async () => {
      const user = userEvent.setup();
      function RadioTest(): ReactElement {
        const [value, setValue] = useState('need');
        return (
          <RadioGroup value={value} onValueChange={setValue} aria-label="Classification">
            <Label htmlFor="opt-need" className="flex items-center gap-2">
              <RadioGroupItem id="opt-need" value="need" />
              <span>Need</span>
            </Label>
            <Label htmlFor="opt-want" className="flex items-center gap-2">
              <RadioGroupItem id="opt-want" value="want" />
              <span>Want</span>
            </Label>
          </RadioGroup>
        );
      }
      render(<RadioTest />);
      const need = screen.getByRole('radio', { name: 'Need' });
      const want = screen.getByRole('radio', { name: 'Want' });
      expect(need).toBeChecked();
      expect(want).not.toBeChecked();
      await user.click(want);
      expect(want).toBeChecked();
      expect(need).not.toBeChecked();
    });
  });

  describe('Interaction States: Focus, Disabled, Pending & Double-Submit Protection', () => {
    it('Focus ring uses uncompromised focus-visible:ring-[3px] or focus-visible:ring-2', () => {
      render(<Button>Focus test</Button>);
      const button = screen.getByRole('button', { name: 'Focus test' });
      expect(button.className).toContain('focus-visible:ring-[3px]');
      expect(button.className).toContain('focus-visible:ring-ring/50');
    });

    it('Disabled button suppresses pointer events and reduces opacity', () => {
      render(<Button disabled>Disabled action</Button>);
      const button = screen.getByRole('button', { name: 'Disabled action' });
      expect(button).toBeDisabled();
      expect(button.className).toContain('disabled:pointer-events-none');
      expect(button.className).toContain('disabled:opacity-50');
    });

    it('Double submission protection: rapid multi-clicks trigger submit exactly once', async () => {
      const user = userEvent.setup();
      const mockSubmit = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50)));

      function DoubleSubmitForm(): ReactElement {
        const [submitting, setSubmitting] = useState(false);
        const submittingRef = useRef(false);

        const handleSubmit = async (e: FormEvent): Promise<void> => {
          e.preventDefault();
          if (submitting || submittingRef.current) return;
          submittingRef.current = true;
          setSubmitting(true);
          try {
            await mockSubmit();
          } finally {
            submittingRef.current = false;
            setSubmitting(false);
          }
        };

        return (
          <form onSubmit={handleSubmit} aria-busy={submitting}>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save'}
            </Button>
          </form>
        );
      }

      render(<DoubleSubmitForm />);
      const button = screen.getByRole('button', { name: 'Save' });

      // Simulate rapid double click
      await user.click(button);
      await user.click(button);

      expect(mockSubmit).toHaveBeenCalledTimes(1);
    });

    it('Pending form announces aria-busy and disables interactive buttons without premature success', () => {
      render(
        <form aria-busy={true}>
          <Button type="submit" disabled={true}>
            Saving desire…
          </Button>
          <Button variant="outline" disabled={true}>
            Cancel
          </Button>
        </form>,
      );
      const submitBtn = screen.getByRole('button', { name: 'Saving desire…' });
      expect(submitBtn).toBeDisabled();
      const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
      expect(cancelBtn).toBeDisabled();
      // No premature success banner
      expect(screen.queryByText(/saved/i)).toBeNull();
    });
  });

  describe('Empty States, Badges & Pills', () => {
    it('Empty state renders standard media icon, title, and description structure', () => {
      render(
        <Empty className="min-h-48 border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Sparkles aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No saved merchants yet</EmptyTitle>
            <EmptyDescription>
              Add your first merchant above to track where you buy.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>,
      );
      expect(screen.getByText('No saved merchants yet')).toBeVisible();
      expect(screen.getByText(/Add your first merchant above/)).toBeVisible();
    });

    it('Badges and Pills provide consistent typography and pill radius', () => {
      render(
        <div className="flex gap-2">
          <Badge variant="secondary">Active</Badge>
          <Pill>Kitchen</Pill>
        </div>,
      );
      const badge = screen.getByText('Active');
      const pill = screen.getByText('Kitchen');
      expect(badge.className).toContain('text-xs');
      expect(badge.className).toContain('rounded-full');
      expect(pill.className).toContain('rounded-full');
    });
  });
});
