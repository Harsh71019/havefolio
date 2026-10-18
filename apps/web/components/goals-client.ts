import type {
  CreateGoalContributionRequest,
  CreateGoalRequest,
  Goal,
  GoalContribution,
  GoalContributionsPage,
  GoalsPage,
  GoalStatus,
  PatchGoalRequest,
} from '@havefolio/contracts';
import { request } from './desires-client';

const goalPath = (id: string): string => `/api/v1/goals/${encodeURIComponent(id)}`;
const withSignal = (signal?: AbortSignal): RequestInit => (signal ? { signal } : {});

/** Bounded owner-scoped list in the API's stable ID order; omit status for every lifecycle. */
export function listGoals(
  options: { after?: string | null; status?: GoalStatus | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<GoalsPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 25) });
  if (options.after) query.set('after', options.after);
  if (options.status) query.set('status', options.status);
  return request(`/api/v1/goals?${query.toString()}`, withSignal(signal));
}
export const getGoal = (id: string, signal?: AbortSignal): Promise<Goal> =>
  request(goalPath(id), withSignal(signal));
export const createGoal = (body: CreateGoalRequest): Promise<Goal> =>
  request('/api/v1/goals', { method: 'POST', body: JSON.stringify(body) });
export const updateGoal = (id: string, body: PatchGoalRequest): Promise<Goal> =>
  request(goalPath(id), { method: 'PATCH', body: JSON.stringify(body) });
export const deleteGoal = (id: string, revision: number): Promise<void> =>
  request(goalPath(id), { method: 'DELETE', body: JSON.stringify({ revision }) });
export function goalContributions(
  id: string,
  options: { before?: number | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<GoalContributionsPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 25) });
  if (options.before) query.set('before', String(options.before));
  return request(`${goalPath(id)}/contributions?${query.toString()}`, withSignal(signal));
}
export const recordContribution = (
  id: string,
  body: CreateGoalContributionRequest,
): Promise<GoalContribution> =>
  request(`${goalPath(id)}/contributions`, { method: 'POST', body: JSON.stringify(body) });
