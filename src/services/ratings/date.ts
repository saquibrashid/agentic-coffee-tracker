export class InvalidRatingDateError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRatingDateError';
  }
}

export function localDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ratedAtToDateInput(ratedAt: string): string {
  return ratedAt.slice(0, 10);
}

export function dateInputToRatedAt(
  value: string,
  existingRatedAt?: string,
  today = localDateInputValue(),
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new InvalidRatingDateError('Choose a valid rating date.');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new InvalidRatingDateError('Choose a valid rating date.');
  }
  if (value > today) throw new InvalidRatingDateError('The rating date cannot be in the future.');

  // Keep the original time and offset when correcting only the calendar day.
  // New date-only ratings use noon UTC so the stored instant is stable and
  // ordering remains deterministic; the UI always renders the YYYY-MM-DD part.
  return existingRatedAt?.includes('T')
    ? `${value}${existingRatedAt.slice(10)}`
    : `${value}T12:00:00.000Z`;
}
