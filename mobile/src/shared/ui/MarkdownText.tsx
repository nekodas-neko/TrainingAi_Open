import { Linking, View } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';
import { parseMarkdown, type Block, type Inline } from './markdown-model';

type BodyVariant = 'body' | 'bodyRelaxed';
type Marks = { bold?: boolean; italic?: boolean };

function Inlines({
  nodes,
  bodyVariant,
  marks = {},
}: {
  nodes: Inline[];
  bodyVariant: BodyVariant;
  marks?: Marks;
}) {
  const { theme } = useTheme();
  return (
    <>
      {nodes.map((node, i) => {
        if (node.type === 'text')
          return marks.bold || marks.italic ? (
            <AppText
              key={i}
              variant={marks.bold ? 'label' : bodyVariant}
              style={marks.italic ? { fontStyle: 'italic' } : undefined}
            >
              {node.text}
            </AppText>
          ) : (
            node.text
          );
        if (node.type === 'code')
          return (
            <AppText
              key={i}
              mono
              variant={bodyVariant}
              style={{ backgroundColor: theme.colors.raised }}
            >
              {node.text}
            </AppText>
          );
        if (node.type === 'link')
          return (
            <AppText
              key={i}
              variant={marks.bold ? 'label' : bodyVariant}
              tone="brand"
              accessibilityRole="link"
              style={{ textDecorationLine: 'underline' }}
              onPress={() => void Linking.openURL(node.href).catch(() => {})}
            >
              <Inlines nodes={node.children} bodyVariant={bodyVariant} marks={marks} />
            </AppText>
          );
        return (
          <Inlines
            key={i}
            nodes={node.children}
            bodyVariant={bodyVariant}
            marks={{ ...marks, [node.type]: true }}
          />
        );
      })}
    </>
  );
}

function BlockView({ block, bodyVariant }: { block: Block; bodyVariant: BodyVariant }) {
  const { theme } = useTheme();
  if (block.type === 'table')
    return (
      <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.control }}>
        {[block.header, ...block.rows].map((row, r) => (
          <View
            key={r}
            style={{
              flexDirection: 'row',
              borderTopWidth: r ? 1 : 0,
              borderColor: theme.colors.border,
            }}
          >
            {row.map((cell, c) => (
              <View key={c} style={{ flex: 1, minWidth: 0, padding: theme.spacing.xs }}>
                <AppText variant={bodyVariant}>
                  <Inlines nodes={cell} bodyVariant={bodyVariant} marks={r === 0 ? { bold: true } : {}} />
                </AppText>
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  if (block.type === 'bullet' || block.type === 'number')
    return (
      <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
        <AppText variant={bodyVariant}>{block.type === 'bullet' ? '•' : block.marker}</AppText>
        <AppText variant={bodyVariant} style={{ flex: 1, minWidth: 0 }}>
          <Inlines nodes={block.children} bodyVariant={bodyVariant} />
        </AppText>
      </View>
    );
  return (
    <AppText variant={block.type === 'heading' ? 'label' : bodyVariant}>
      <Inlines nodes={block.children} bodyVariant={bodyVariant} />
    </AppText>
  );
}

export function MarkdownText({
  children,
  bodyVariant = 'body',
}: {
  children: string;
  bodyVariant?: BodyVariant;
}) {
  return (
    <Stack>
      {parseMarkdown(children).map((block, i) => (
        <BlockView key={i} block={block} bodyVariant={bodyVariant} />
      ))}
    </Stack>
  );
}
