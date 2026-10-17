import { capitalize } from '@trainingai/shared/format/capitalize';
import { labelFor as sharedLabel } from '@trainingai/shared/health/contributor-labels';

// The current app's wording, from the shared label map ("REM sleep", not "Rem sleep"). A key the map
// does not know falls back to its words with a capital.
export function labelFor(key: string) {
  const label = sharedLabel(key);
  return capitalize(label === key ? key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() : label);
}
