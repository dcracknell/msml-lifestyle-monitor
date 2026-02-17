import { useEffect, useRef } from 'react';
import Animated, * as ReanimatedExports from 'react-native-reanimated';
import { useEvent } from 'react-native-reanimated/lib/module/hook/useEvent';
import { areDependenciesEqual, buildDependencies } from 'react-native-reanimated/lib/module/hook/utils';
import { IS_JEST, IS_WEB } from 'react-native-reanimated/lib/module/common';
import { makeShareable } from 'react-native-worklets';

type GestureEvent = {
  state?: number;
  oldState?: number;
  nativeEvent?: Record<string, unknown>;
} & Record<string, unknown>;

type GestureHandlers<TContext> = {
  onStart?: (event: GestureEvent, context: TContext) => void;
  onActive?: (event: GestureEvent, context: TContext) => void;
  onEnd?: (event: GestureEvent, context: TContext) => void;
  onFail?: (event: GestureEvent, context: TContext) => void;
  onCancel?: (event: GestureEvent, context: TContext) => void;
  onFinish?: (event: GestureEvent, context: TContext, wasCancelled: boolean) => void;
};

const EVENT_TYPE = {
  UNDETERMINED: 0,
  FAILED: 1,
  BEGAN: 2,
  CANCELLED: 3,
  ACTIVE: 4,
  END: 5,
};

type Dependencies = ReadonlyArray<unknown> | undefined;

function useLegacyHandler<TContext>(
  handlers: Partial<GestureHandlers<TContext>>,
  dependencies?: Dependencies
) {
  const initRef = useRef<{ context: TContext; savedDependencies: unknown[] } | null>(null);

  if (initRef.current === null) {
    const context = makeShareable({}) as TContext;
    initRef.current = {
      context,
      savedDependencies: [],
    };
  }

  useEffect(() => {
    return () => {
      initRef.current = null;
    };
  }, []);

  const { context, savedDependencies } = initRef.current!;
  const builtDependencies = buildDependencies(dependencies, handlers);
  const doDependenciesDiffer = !areDependenciesEqual(builtDependencies, savedDependencies);
  initRef.current!.savedDependencies = builtDependencies;
  const useWeb = IS_WEB || IS_JEST;

  return {
    context,
    doDependenciesDiffer,
    useWeb,
  };
}

function installCompat() {
  const moduleExports = ReanimatedExports as Record<string, unknown>;
  const animatedDefault = Animated as Record<string, unknown>;

  if (typeof moduleExports.useAnimatedGestureHandler === 'function') {
    return;
  }

  const compat = function useAnimatedGestureHandlerCompat<TContext>(
    handlers: GestureHandlers<TContext> = {},
    dependencies?: Dependencies
  ) {
    const { context, doDependenciesDiffer, useWeb } = useLegacyHandler(handlers, dependencies);

    const handler = (eventArg: GestureEvent) => {
      'worklet';

      const event = useWeb ? eventArg.nativeEvent || eventArg : eventArg;

      if (event.state === EVENT_TYPE.BEGAN && handlers.onStart) {
        handlers.onStart(event, context);
      }

      if (event.state === EVENT_TYPE.ACTIVE && handlers.onActive) {
        handlers.onActive(event, context);
      }

      const isOldStateActive = event.oldState === EVENT_TYPE.ACTIVE;
      const didFinish = event.state === EVENT_TYPE.END;

      if (isOldStateActive && didFinish && handlers.onEnd) {
        handlers.onEnd(event, context);
      }

      if (event.oldState === EVENT_TYPE.BEGAN && event.state === EVENT_TYPE.FAILED && handlers.onFail) {
        handlers.onFail(event, context);
      }

      const didCancel = isOldStateActive && event.state === EVENT_TYPE.CANCELLED;
      if (didCancel && handlers.onCancel) {
        handlers.onCancel(event, context);
      }

      const wentInactiveFromActive =
        (event.oldState === EVENT_TYPE.BEGAN || isOldStateActive) &&
        event.state !== EVENT_TYPE.BEGAN &&
        event.state !== EVENT_TYPE.ACTIVE;

      if (wentInactiveFromActive && handlers.onFinish) {
        const wasCancelled = event.state === EVENT_TYPE.CANCELLED || event.state === EVENT_TYPE.FAILED;
        handlers.onFinish(event, context, wasCancelled);
      }
    };

    if (useWeb) {
      return handler;
    }

    return useEvent(handler, ['onGestureHandlerStateChange', 'onGestureHandlerEvent'], doDependenciesDiffer);
  };

  moduleExports.useAnimatedGestureHandler = compat;

  if (animatedDefault && typeof animatedDefault === 'object') {
    animatedDefault.useAnimatedGestureHandler = compat;
  }
}

installCompat();

export {};
