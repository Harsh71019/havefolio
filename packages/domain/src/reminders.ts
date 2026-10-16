export const desireReminderQueue = 'desire-reminders' as const;
export const desireReminderJob = 'desire.wait-ended' as const;

export interface DesireReminderJobData {
  desireId: string;
  scheduleVersion: number;
  scheduledFor: string;
}

export function desireReminderJobId(desireId: string, scheduleVersion: number): string {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(desireId)
  ) {
    throw new Error('INVALID_REMINDER_JOB');
  }
  if (!Number.isSafeInteger(scheduleVersion) || scheduleVersion < 1) {
    throw new Error('INVALID_REMINDER_JOB');
  }
  return `desire-reminder-${desireId}-${scheduleVersion}`;
}

export function isDesireReminderJobData(value: unknown): value is DesireReminderJobData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.desireId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      data.desireId,
    ) &&
    Number.isSafeInteger(data.scheduleVersion) &&
    Number(data.scheduleVersion) >= 1 &&
    typeof data.scheduledFor === 'string' &&
    Number.isFinite(Date.parse(data.scheduledFor))
  );
}
