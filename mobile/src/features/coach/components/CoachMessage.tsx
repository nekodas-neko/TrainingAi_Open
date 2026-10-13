import { Linking, View } from 'react-native';
import type { UIMessage } from 'ai';
import { AppButton, AppText, Card, MarkdownText, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  isWidgetToolName,
  WidgetResultSchema,
  type ChangePreviewArgs,
  type WidgetResult,
} from '../data/widgets';
import { stripToolCitations } from '../data/models';
import { CoachWidget, type Destination } from './CoachWidget';
type Part = {
  type: string;
  text?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: WidgetResult;
  url?: string;
  title?: string;
};
export function CoachMessage({
  message,
  live,
  onResult,
  onReopen,
  onReview,
  onNavigate,
}: {
  message: UIMessage;
  live: boolean;
  onResult: (id: string, result: WidgetResult) => void;
  onReopen: (id: string) => void;
  onReview: (id: string, args: ChangePreviewArgs) => void;
  onNavigate: (destination: Destination) => void;
}) {
  const parts = message.parts as Part[];
  if (message.role === 'user')
    return (
      <Bubble user>
        {parts
          .filter((p) => p.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text)
          .join('')}
      </Bubble>
    );
  return (
    <Stack>
      {parts.map((p, i) => {
        if (p.type === 'text' && typeof p.text === 'string' && p.text)
          return <Bubble key={i}>{stripToolCitations(p.text)}</Bubble>;
        if (p.type === 'source-url' && p.url) {
          let url: URL;
          try {
            url = new URL(p.url);
            if (url.protocol !== 'https:') return null;
          } catch {
            return null;
          }
          return (
            <AppButton
              key={i}
              title={p.title ?? url.hostname}
              variant="ghost"
              onPress={() => {
                void Linking.openURL(url.href).catch(() => {});
              }}
            />
          );
        }
        if (!p.toolCallId || !p.type.startsWith('tool-') || !isWidgetToolName(p.type.slice(5)))
          return null;
        if (p.type !== 'tool-renderChart' && p.state === 'output-available' && p.output) {
          const parsed = WidgetResultSchema.safeParse(p.output);
          if (!parsed.success)
            return (
              <AppText key={i} tone="muted">
                This saved step could not be shown. Ask Coach for a fresh one.
              </AppText>
            );
          const output = parsed.data;
          if (output.status === 'chose')
            return (
              <View key={i} style={{ alignSelf: 'flex-end', maxWidth: '86%' }}>
                <AppButton
                  title={`${output.label} ↶`}
                  variant="surface"
                  onPress={() => onReopen(p.toolCallId!)}
                />
              </View>
            );
          if (output.status === 'applied')
            return (
              <Card key={i} tone="recovery">
                <AppText>✓ {output.summary}</AppText>
              </Card>
            );
          return (
            <AppText key={i} variant="caption" tone="muted">
              {output.status === 'stale'
                ? output.detail
                : output.status === 'shown'
                  ? ''
                  : 'Dismissed.'}
            </AppText>
          );
        }
        if (!['input-available', 'output-available'].includes(p.state ?? '')) return null;
        return (
          <CoachWidget
            key={p.toolCallId}
            input={p.input}
            onResult={
              live && p.state === 'input-available'
                ? (result) => onResult(p.toolCallId!, result)
                : undefined
            }
            onReview={(args) => onReview(p.toolCallId!, args)}
            onNavigate={onNavigate}
          />
        );
      })}
    </Stack>
  );
}
function Bubble({ user = false, children }: { user?: boolean; children: string }) {
  const { theme } = useTheme();
  if (!children.trim()) return null;
  return (
    <View
      style={{
        alignSelf: user ? 'flex-end' : 'flex-start',
        maxWidth: user ? '86%' : '92%',
        padding: theme.spacing.md,
        borderRadius: theme.radii.card,
        backgroundColor: user ? theme.colors.text : theme.colors.raised,
      }}
    >
      {user ? (
        <AppText selectable style={{ color: theme.colors.background }}>
          {children}
        </AppText>
      ) : (
        <MarkdownText>{children}</MarkdownText>
      )}
    </View>
  );
}
