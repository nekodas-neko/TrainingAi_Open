import { AppText } from './AppText';
import { Stack } from './Stack';
export function MarkdownText({ children }: { children: string }) {
  return (
    <Stack>
      {children
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line, i) => (
          <AppText key={i} variant={/^#{1,6} /.test(line) ? 'label' : 'body'}>
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
