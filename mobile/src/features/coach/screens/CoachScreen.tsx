import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';
import { useChat } from '@ai-sdk/react';
import {
  AppButton,
  AppText,
  Card,
  ChatComposer,
  HoldButton,
  Icon,
  IconButton,
  PageLayout,
  Stack,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useCoach } from '../CoachProvider';
import { coachError, type CoachScope, type previewSchema } from '../data/models';
import type { ChangePreviewArgs } from '../data/widgets';
import type { z } from 'zod';
import { CoachMessage } from '../components/CoachMessage';
import { CoachHistory } from '../components/CoachHistory';
import { ChangeRows, Consequences } from '../components/CoachChanges';
import type { Destination } from '../components/CoachWidget';
import type { CoachConversation } from '../data/CoachConversation';
import { failureNotice } from '../../../core/reporting/index.ts';
export function CoachScreen({
  scope,
  onBack,
  onNavigate,
}: {
  scope: CoachScope;
  onBack: () => void;
  onNavigate: (destination: Destination) => void;
}) {
  const coach = useCoach();
  return coach ? (
    <Conversation
      key={scope}
      conversation={coach.conversations[scope]}
      onBack={onBack}
      onNavigate={onNavigate}
    />
  ) : (
    <PageLayout title="AI Coach" onBack={onBack}>
      <Card>
        <AppText>Sign in to use AI Coach.</AppText>
      </Card>
    </PageLayout>
  );
}
function Conversation({
  conversation,
  onBack,
  onNavigate,
}: {
  conversation: CoachConversation;
  onBack: () => void;
  onNavigate: (destination: Destination) => void;
}) {
  const { theme } = useTheme(),
    state = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const chat = useChat({ chat: conversation.chat, experimental_throttle: 100 });
  const [history, setHistory] = useState(false),
    [review, setReview] = useState<{ id: string; args: ChangePreviewArgs } | null>(null);
  const scroll = useRef<ScrollView>(null),
    nearBottom = useRef(true);
  const busy = chat.status === 'submitted' || chat.status === 'streaming';
  useEffect(() => {
    conversation.enter();
    return () => conversation.leave();
  }, [conversation]);
  const lastAssistant = chat.messages.findLastIndex((m) => m.role === 'assistant');
  function leave() {
    conversation.stop();
    onBack();
  }
  if (review)
    return (
      <ReviewChange
        args={review.args}
        onBack={() => setReview(null)}
        onApplied={(summary) => {
          conversation.resolve(review.id, { status: 'applied', summary });
          setReview(null);
        }}
      />
    );
  return (
    <PageLayout
      title="AI Coach"
      onBack={history ? () => setHistory(false) : leave}
      actions={
        <IconButton
          icon="history"
          label="History"
          disabled={busy}
          onPress={() => setHistory((value) => !value)}
        />
      }
      footer={
        !history ? (
          <ChatComposer
            value={state.input}
            onChange={(value) => conversation.input(value)}
            disabled={!state.ready || state.opening}
            busy={busy}
            onStop={() => conversation.stop()}
            onSend={() => {
              void conversation.send();
            }}
          />
        ) : undefined
      }
    >
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
        onScroll={(event) => {
          const n = event.nativeEvent;
          nearBottom.current =
            n.contentSize.height - n.layoutMeasurement.height - n.contentOffset.y < 100;
        }}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          if (!history && nearBottom.current) scroll.current?.scrollToEnd({ animated: false });
        }}
      >
        {history ? (
          <CoachHistory
            opening={state.opening}
            localThreads={state.localThreads}
            onOpen={(id) => {
              void conversation.open(id).then((opened) => {
                if (opened) {
                  setHistory(false);
                  nearBottom.current = true;
                }
              });
            }}
            onNew={() => {
              void conversation.newConversation().then((started) => {
                if (started) {
                  setHistory(false);
                  nearBottom.current = true;
                }
              });
            }}
          />
        ) : (
          <>
            {chat.messages.length === 0 && (
              <Stack align="center" gap="md" style={{ paddingTop: theme.spacing.xl * 2 }}>
                <Icon name="coach" color={theme.tones.sleep.foreground} />
                <AppText variant="heading" style={{ textAlign: 'center' }}>
                  What do you want{'\n'}to work on?
                </AppText>
                <AppText
                  variant="caption"
                  tone="muted"
                  style={{ textAlign: 'center', maxWidth: 265 }}
                >
                  I can look at your data, explain something, or change your program — nothing
                  changes without you confirming it.
                </AppText>
                <Stack style={{ alignSelf: 'stretch', paddingTop: theme.spacing.lg }}>
                  {[
                    'Change my workout',
                    'What can I eat instead of rice',
                    'What’s lagging?',
                  ].map((s) => (
                    <AppButton
                      key={s}
                      title={s}
                      variant="surface"
                      disabled={!state.ready}
                      style={{ alignItems: 'flex-start' }}
                      onPress={() => {
                        void conversation.send(s);
                      }}
                    />
                  ))}
                </Stack>
              </Stack>
            )}
            <Stack style={{ opacity: state.input.trim() ? 0.6 : 1 }}>
              {chat.messages.map((message, i) => (
                <CoachMessage
                  key={message.id}
                  message={message}
                  live={i === lastAssistant && !busy}
                  onResult={(id, result) => conversation.resolve(id, result)}
                  onReopen={(id) => conversation.reopen(id)}
                  onReview={(id, args) => setReview({ id, args })}
                  onNavigate={(destination) => {
                    conversation.stop();
                    onNavigate(destination);
                  }}
                />
              ))}
            </Stack>
            {busy && (
              <AppText variant="caption" tone="muted">
                Thinking…
              </AppText>
            )}
            {chat.messages.length >= 60 && (
              <Card>
                <AppText>This conversation is full. Start a new one to continue.</AppText>
                <AppButton
                  title="New conversation"
                  onPress={() => conversation.newConversation()}
                />
              </Card>
            )}
            {(chat.error || state.stopped) && (
              <Card tone="heart">
                <AppText>
                  {chat.error
                    ? coachError(chat.error)
                    : 'This reply was stopped. Retry to get the rest of the answer.'}
                </AppText>
                <AppButton
                  title="Retry reply"
                  disabled={busy}
                  onPress={() => {
                    void conversation.retry();
                  }}
                />
              </Card>
            )}
          </>
        )}
        {history && state.openError && <AppText tone="danger">{state.openError}</AppText>}
        {state.localError && (
          <Card tone="heart">
            <AppText>{state.localError}</AppText>
            <AppButton
              title={state.ready ? 'Retry saving on phone' : 'Retry loading conversation'}
              onPress={() => {
                if (state.ready) conversation.checkpoint();
                else void conversation.initialize();
              }}
            />
          </Card>
        )}
        {state.historyError && (
          <Card>
            <AppText>{state.historyError} Your conversation stays on this phone.</AppText>
            <AppButton
              title="Retry saving history"
              variant="ghost"
              disabled={busy || state.opening}
              onPress={() => {
                void conversation.saveHistory(true);
              }}
            />
          </Card>
        )}
      </ScrollView>
    </PageLayout>
  );
}
function ReviewChange({
  args,
  onBack,
  onApplied,
}: {
  args: ChangePreviewArgs;
  onBack: () => void;
  onApplied: (summary: string) => void;
}) {
  const coach = useCoach(),
    [preview, setPreview] = useState<z.infer<typeof previewSchema> | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const guard = useRef(false);
  useEffect(() => {
    let current = true;
    void coach?.actions
      .preview(args.patch)
      .then((p) => {
        if (current) {
          setPreview(p);
          setError(null);
        }
      })
      .catch((failure) => {
        if (current) setError(failureNotice(
          'Could not check the consequences. Retry before confirming.',
          failure,
        ));
      });
    return () => {
      current = false;
    };
  }, [coach, args.patch, retry]);
  async function apply() {
    if (guard.current || !coach || !preview || preview.drift.length) return;
    guard.current = true;
    setBusy(true);
    try {
      const result = await coach.actions.apply(
        args.patch,
        args.patch.changes.map((c) => c.id),
      );
      if (result) onApplied(result.summary);
    } catch (cause) {
      setError(coachError(cause, 'apply this change'));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <PageLayout
      title="Review change"
      subtitle="This affects your whole block"
      onBack={!busy ? onBack : undefined}
      scroll
      footer={
        <Stack>
          <Stack direction="row">
            <AppButton
              title="Cancel"
              variant="surface"
              disabled={busy}
              style={{ flex: 1 }}
              onPress={onBack}
            />
            <View style={{ flex: 1.6 }}>
              <HoldButton
                title={busy ? 'Applying…' : 'Hold to apply'}
                disabled={busy || !preview || !!preview.drift.length}
                onConfirm={() => {
                  void apply();
                }}
              />
            </View>
          </Stack>
          <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            Undoable until your next workout
          </AppText>
        </Stack>
      }
    >
      <Stack>
        <AppText variant="heading">{args.title}</AppText>
        <Card>
          <ChangeRows patch={args.patch} />
        </Card>
        <AppText variant="label">What this does</AppText>
        <Consequences data={preview} />
        {error && <AppText tone="danger">{error}</AppText>}
        {!preview && (
          <AppButton
            title={error ? 'Retry preview' : 'Checking consequences…'}
            disabled={!error}
            variant="ghost"
            onPress={() => setRetry((n) => n + 1)}
          />
        )}
      </Stack>
    </PageLayout>
  );
}
