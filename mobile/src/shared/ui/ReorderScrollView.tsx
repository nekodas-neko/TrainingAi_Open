import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';

type DragScroll = {
  begin: (pageY: number, onScroll: (delta: number) => void) => void;
  move: (pageY: number) => void;
  end: () => void;
};
const Context = createContext<DragScroll | null>(null);
export const useDragScroll = () => useContext(Context);
export function ReorderScrollView({
  children,
  onScroll,
  onLayout,
  onContentSizeChange,
  scrollEnabled = true,
  scrollRef,
  ...props
}: ScrollViewProps & { scrollRef?: Ref<ScrollView> }) {
  const view = useRef<ScrollView>(null);
  const attach = useCallback(
    (node: ScrollView | null) => {
      view.current = node;
      if (typeof scrollRef === 'function') scrollRef(node);
      else if (scrollRef) scrollRef.current = node;
    },
    [scrollRef],
  );
  const [dragging, setDragging] = useState(false);
  const geometry = useRef({ top: 0, height: 0, content: 0, offset: 0 });
  const drag = useRef<{
    pageY: number;
    origin: number;
    onScroll: (delta: number) => void;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    drag.current = null;
  };
  useEffect(() => stop, []);
  const control = useMemo<DragScroll>(
    () => ({
      begin(pageY, onDragScroll) {
        stop();
        setDragging(true);
        drag.current = { pageY, origin: geometry.current.offset, onScroll: onDragScroll };
        view.current?.getNativeScrollRef()?.measureInWindow((_, top, __, height) => {
          geometry.current.top = top;
          geometry.current.height = height;
        });
        timer.current = setInterval(() => {
          const current = drag.current;
          const layout = geometry.current;
          if (!current || !layout.height) return;
          const edge = Math.min(72, layout.height / 4);
          const localY = current.pageY - layout.top;
          const strength =
            localY < edge
              ? -Math.min(1, (edge - localY) / edge)
              : localY > layout.height - edge
                ? Math.min(1, (localY - layout.height + edge) / edge)
                : 0;
          const offset = Math.max(
            0,
            Math.min(layout.content - layout.height, layout.offset + strength * 12),
          );
          if (!strength || offset === layout.offset) return;
          layout.offset = offset;
          view.current?.scrollTo({ y: offset, animated: false });
          current.onScroll(offset - current.origin);
        }, 32);
      },
      move(pageY) {
        if (drag.current) drag.current.pageY = pageY;
      },
      end() {
        stop();
        setDragging(false);
      },
    }),
    [],
  );
  return (
    <Context.Provider value={control}>
      <ScrollView
        {...props}
        ref={attach}
        scrollEnabled={scrollEnabled && !dragging}
        scrollEventThrottle={16}
        onLayout={(event) => {
          geometry.current.height = event.nativeEvent.layout.height;
          onLayout?.(event);
        }}
        onContentSizeChange={(width, height) => {
          geometry.current.content = height;
          onContentSizeChange?.(width, height);
        }}
        onScroll={(event) => {
          geometry.current.offset = event.nativeEvent.contentOffset.y;
          onScroll?.(event);
        }}
      >
        {children}
      </ScrollView>
    </Context.Provider>
  );
}
