import { aiFailureText } from '../../account/api/client.ts';

export const GOAL_REVIEW_FAILED =
  'Could not review goals. Check your height, weight, sex, date of birth and fitness goal in Profile.';

export function goalReviewError(cause: unknown) {
  return aiFailureText(cause, GOAL_REVIEW_FAILED);
}
