import {
  currencyMinorDigits,
  isFinancialDomainError,
  parseDecimalAmount,
  parseMinorUnits,
  toDecimalString,
  toMinorUnitsString,
} from '@havefolio/domain';

/** Plain-language entry guidance for the shared domain money codes. */
export function amountEntryMessage(code: string, currency: string): string {
  const digits = currencyMinorDigits(currency);
  switch (code) {
    case 'MONEY_PRECISION_EXCEEDED':
      return digits === 0
        ? `Amounts in ${currency} cannot have decimal places.`
        : `Amounts in ${currency} cannot have more than ${digits} decimal place${digits === 1 ? '' : 's'}.`;
    case 'UNSAFE_MONEY_VALUE':
      return 'That amount is larger than Havefolio can store.';
    case 'INVALID_CURRENCY':
      return 'Choose a currency.';
    default:
      return 'Enter a valid positive number or 0, like 1,299.50.';
  }
}

/**
 * Exact minor units from what the owner typed. Malformed input or extra decimal digits are
 * rejected with a readable message, never rounded.
 */
export function amountEntryToMinor(display: string, currency: string): string {
  try {
    return toMinorUnitsString(parseDecimalAmount(display, currency));
  } catch (error) {
    throw new Error(amountEntryMessage(isFinancialDomainError(error) ? error.code : '', currency), {
      cause: error,
    });
  }
}

/** The stored amount as an editable plain decimal ("1299.50"); empty when not recorded. */
export function minorToAmountEntry(minor: string | null | undefined, currency: string): string {
  return minor == null ? '' : toDecimalString(parseMinorUnits(minor, currency));
}
