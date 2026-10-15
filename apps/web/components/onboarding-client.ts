import type { OnboardingAction, OnboardingStatus } from '@havefolio/contracts';
import { ItemRequestError } from './items-client';
export async function onboardingRequest(
  operation: 'read' | 'demo' | 'remove' | OnboardingAction = 'read',
): Promise<OnboardingStatus> {
  const action = !['read', 'demo', 'remove'].includes(operation);
  let response: Response;
  try {
    response = await fetch(
      `/api/v1/onboarding${action ? '/actions' : operation === 'read' ? '' : '/demo'}`,
      {
        method: action || operation === 'demo' ? 'POST' : operation === 'remove' ? 'DELETE' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        ...(action
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: operation }),
            }
          : {}),
      },
    );
  } catch {
    throw new ItemRequestError(0, 'Unable to connect. You can still open manual entry.');
  }
  if (!response.ok)
    throw new ItemRequestError(
      response.status,
      response.status === 401
        ? 'Sign in to view your private welcome checklist.'
        : 'Could not update the welcome checklist. Try again.',
    );
  return response.json() as Promise<OnboardingStatus>;
}
