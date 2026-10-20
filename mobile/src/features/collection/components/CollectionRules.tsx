import { collectionRules } from '@trainingai/shared/collection/rules';
import { AppText, Card } from '../../../shared/ui';

/**
 * "How this works": the explanation is the point of the screen, not a footnote, since a decay nobody
 * explained reads as a bug. The paragraphs come from the engine's own constants.
 */
export function CollectionRules() {
  return (
    <Card>
      <AppText variant="subheading">How this works</AppText>
      {collectionRules().map((paragraph, i) => (
        <AppText key={i} variant="caption" tone="muted">
          {paragraph.map((segment, j) =>
            segment.style ? (
              <AppText
                key={j}
                variant="caption"
                style={{ fontWeight: segment.style === 'lead' ? '500' : '400' }}
              >
                {segment.text}
              </AppText>
            ) : (
              segment.text
            ),
          )}
        </AppText>
      ))}
    </Card>
  );
}
