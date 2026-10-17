import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConvertDesireRequest,
  DesireConversion,
  DesireConversionState,
} from '@havefolio/contracts';
import type * as DesiresClient from '../components/desires-client';
import { DesireConversionFlow } from '../components/desire-conversion';
import {
  convertDesire,
  DesireRequestError,
  getConversion,
  resumeConversionPhoto,
} from '../components/desires-client';

vi.mock('../components/desires-client', async (importOriginal) => {
  const actual = await importOriginal<typeof DesiresClient>();
  return {
    ...actual,
    getConversion: vi.fn(),
    convertDesire: vi.fn(),
    resumeConversionPhoto: vi.fn(),
  };
});

const id = 'd1000000-0000-4000-a000-000000000001';
const eligible: DesireConversionState = {
  desireId: id,
  eligibility: 'eligible',
  boughtEventId: 'e1000000-0000-4000-a000-000000000001',
  suggestions: {
    name: 'Synthetic kettle',
    notes: 'Synthetic reason',
    productUrl: 'https://shop.example.test/kettle',
    photo: null,
    likelyPriceMinor: '129900',
    likelyCurrency: 'INR',
  },
  conversion: null,
};
const converted: DesireConversion = {
  id: 'c1000000-0000-4000-a000-000000000001',
  desireId: id,
  itemId: 'i1000000-0000-4000-a000-000000000001',
  itemName: 'Synthetic kettle',
  boughtEventId: eligible.boughtEventId!,
  boughtOutcomeCurrent: true,
  photo: 'not_requested',
  createdAt: '2026-10-17T08:00:00.000Z',
};

const choose = async (user: UserEvent, combo: string, option: RegExp | string): Promise<void> => {
  await user.click(screen.getByRole('combobox', { name: combo }));
  await user.click(await screen.findByRole('option', { name: option }));
};
const confirmFacts = async (user: UserEvent): Promise<void> => {
  await user.click(screen.getByRole('radio', { name: 'I know the amount' }));
  await user.type(screen.getByLabelText('Amount paid'), '0');
  await choose(user, 'Currency paid', /INR/);
  await user.click(screen.getByRole('radio', { name: 'Month and year' }));
  await choose(user, 'Month', 'February');
  await user.type(screen.getByLabelText('Year'), '2026');
  await choose(user, 'How you got it', 'Gift');
  await choose(user, 'Ownership now', 'Currently owned');
  await choose(user, 'Condition', 'Working well');
  await choose(user, 'Expected use', /Often/);
};

beforeEach(() => {
  vi.mocked(getConversion).mockResolvedValue(eligible);
  vi.mocked(convertDesire).mockResolvedValue(converted);
});
afterEach(() => vi.resetAllMocks());

describe('PER-29 bought desire conversion', () => {
  it('announces loading, then separates copied suggestions from unconfirmed facts', async () => {
    render(<DesireConversionFlow desireId={id} />);
    expect(screen.getByRole('status', { name: 'Loading purchase details' })).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Add to your inventory' });
    expect(screen.getByLabelText('Item name')).toHaveValue('Synthetic kettle');
    expect(screen.getAllByText('Suggested from your want').length).toBeGreaterThan(0);
    // Facts are never prefilled; the likely price is reference only.
    expect(screen.getByRole('radio', { name: 'I know the amount' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /I don’t know \(left out/ })).not.toBeChecked();
    expect(
      screen.getByText(/You estimated .*1,299.*not used as the price paid/),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Currency paid' })).toHaveTextContent(
      'Choose currency',
    );
    expect(screen.getByRole('link', { name: 'Keep only the bought decision' })).toHaveAttribute(
      'href',
      `/wants/${id}/history`,
    );
    await userEvent.setup().type(screen.getByLabelText('Item name'), ' v2');
    expect(screen.getByText('Edited by you')).toBeInTheDocument();
  });

  it('requires explicit confirmation of every fact before submitting', async () => {
    const user = userEvent.setup();
    render(<DesireConversionFlow desireId={id} />);
    await screen.findByRole('heading', { name: 'Add to your inventory' });
    await user.click(screen.getByRole('button', { name: 'Add to inventory' }));
    const summary = await screen.findByRole('alert');
    for (const text of [
      /amount you paid, or choose I don’t know/,
      /currency you paid in/,
      /purchase date/,
      /how you got it/,
      /current condition/,
      /how often/,
      /ownership status/,
    ])
      expect(within(summary).getByText(text)).toBeInTheDocument();
    await waitFor(() => expect(summary).toHaveFocus());
    expect(convertDesire).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Currency paid' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('submits explicit zero, gift, partial date and opted-in link without the likely price', async () => {
    const user = userEvent.setup();
    render(<DesireConversionFlow desireId={id} />);
    await screen.findByRole('heading', { name: 'Add to your inventory' });
    await confirmFacts(user);
    await user.click(screen.getByRole('checkbox', { name: 'Add the product link to notes' }));
    await user.click(screen.getByRole('button', { name: 'Add to inventory' }));
    await screen.findByText('Added to your inventory.');
    const [desireId, command] = vi.mocked(convertDesire).mock.calls[0]!;
    expect(desireId).toBe(id);
    expect(command).toMatchObject({
      boughtEventId: eligible.boughtEventId!,
      copyPhoto: false,
      item: {
        name: 'Synthetic kettle',
        currency: 'INR',
        pricePaid: { state: 'known', minor: '0' },
        purchaseDate: { precision: 'month', year: 2026, month: 2 },
        acquisitionType: 'gift',
        ownershipStatus: 'owned',
        condition: 'working',
        useFrequency: 'often',
        notes: 'Synthetic reason\n\nProduct link: https://shop.example.test/kettle',
      },
    } satisfies Partial<ConvertDesireRequest>);
    expect(JSON.stringify(command)).not.toContain('129900');
    expect(screen.getByRole('link', { name: 'Synthetic kettle' })).toHaveAttribute(
      'href',
      `/items/${converted.itemId}`,
    );
  });

  it('rejects amounts beyond the currency precision without rounding', async () => {
    const user = userEvent.setup();
    render(<DesireConversionFlow desireId={id} />);
    await screen.findByRole('heading', { name: 'Add to your inventory' });
    await confirmFacts(user);
    await user.clear(screen.getByLabelText('Amount paid'));
    await user.type(screen.getByLabelText('Amount paid'), '10.999');
    await user.click(screen.getByRole('button', { name: 'Add to inventory' }));
    expect(await screen.findAllByText(/cannot have more than 2 decimal places/)).toHaveLength(2);
    expect(convertDesire).not.toHaveBeenCalled();
  });

  it('retries the identical command after an ambiguous failure', async () => {
    const user = userEvent.setup();
    vi.mocked(convertDesire)
      .mockRejectedValueOnce(new DesireRequestError(0, 'NETWORK', 'Unable to connect.'))
      .mockResolvedValueOnce(converted);
    render(<DesireConversionFlow desireId={id} />);
    await screen.findByRole('heading', { name: 'Add to your inventory' });
    await confirmFacts(user);
    await user.click(screen.getByRole('button', { name: 'Add to inventory' }));
    expect(await screen.findByText('Unable to connect.')).toBeInTheDocument();
    expect(screen.getByLabelText('Item name')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry same submission' }));
    await screen.findByText('Added to your inventory.');
    const [first, second] = vi.mocked(convertDesire).mock.calls;
    expect(second![1]).toEqual(first![1]);
  });

  it('explains stale outcomes and identifies an existing conversion on conflict', async () => {
    const user = userEvent.setup();
    vi.mocked(convertDesire).mockRejectedValueOnce(
      new DesireRequestError(409, 'STALE_BOUGHT_OUTCOME', 'The bought decision changed elsewhere.'),
    );
    render(<DesireConversionFlow desireId={id} />);
    await screen.findByRole('heading', { name: 'Add to your inventory' });
    await confirmFacts(user);
    await user.click(screen.getByRole('button', { name: 'Add to inventory' }));
    expect(await screen.findByText('This want changed')).toBeInTheDocument();
    vi.mocked(getConversion).mockResolvedValueOnce({
      ...eligible,
      eligibility: 'converted',
      conversion: converted,
    });
    await user.click(screen.getByRole('button', { name: 'Reload latest' }));
    expect(await screen.findByRole('heading', { name: 'In your inventory' })).toBeInTheDocument();
  });

  it('shows not-bought, corrected and pending-photo states with a photo retry', async () => {
    vi.mocked(getConversion).mockResolvedValueOnce({
      ...eligible,
      eligibility: 'not_bought',
      boughtEventId: null,
    });
    const { unmount } = render(<DesireConversionFlow desireId={id} />);
    expect(await screen.findByRole('heading', { name: 'Record bought first' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to inventory' })).not.toBeInTheDocument();
    unmount();
    vi.mocked(getConversion).mockResolvedValueOnce({
      ...eligible,
      eligibility: 'converted',
      boughtEventId: null,
      conversion: { ...converted, photo: 'pending', boughtOutcomeCurrent: false },
    });
    vi.mocked(resumeConversionPhoto).mockResolvedValueOnce({ ...converted, photo: 'copied' });
    const user = userEvent.setup();
    render(<DesireConversionFlow desireId={id} />);
    expect(await screen.findByText(/corrected afterwards\. The item was kept/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry photo copy' }));
    expect(
      await screen.findAllByText(/photo was copied to the item\. The original stays/),
    ).not.toHaveLength(0);
  });

  it('recovers from load failures', async () => {
    vi.mocked(getConversion)
      .mockRejectedValueOnce(new DesireRequestError(503, 'DESIRES_UNAVAILABLE', 'Unavailable.'))
      .mockResolvedValueOnce(eligible);
    const user = userEvent.setup();
    render(<DesireConversionFlow desireId={id} />);
    expect(await screen.findByText('Unavailable.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(
      await screen.findByRole('heading', { name: 'Add to your inventory' }),
    ).toBeInTheDocument();
  });
});
