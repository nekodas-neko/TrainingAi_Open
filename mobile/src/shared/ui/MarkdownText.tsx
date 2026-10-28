import { AppText } from './AppText';
import { Stack } from './Stack';
export function MarkdownText({
  children,
  bodyVariant = 'body',
}: {
  children: string;
  bodyVariant?: 'body' | 'bodyRelaxed';
}) {
  return (
    <Stack>
      {children
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line, i) => (
          <AppText key={i} variant={/^#{1,6} /.test(line) ? 'label' : bodyVariant}>
            {line
              .replace(/^#{1,6} /, '')
              .replace(/^[-*] /, '• ')
              .split(/(\*\*[^*]+\*\*)/)
              .map((part, j) =>
                part.startsWith('**') ? (
                  <AppText key={j} variant="label">
                    {part.slice(2, -2)}
                  </AppText>
                ) : (
                  part
                ),
              )}
          </AppText>
        ))}
    </Stack>
  );
}
