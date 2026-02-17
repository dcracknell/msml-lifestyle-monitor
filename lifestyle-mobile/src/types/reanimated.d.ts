declare module 'react-native-reanimated/lib/module/hook/useEvent' {
  export function useEvent<T extends (...args: any[]) => void>(
    handler: T,
    eventNames?: string[],
    rebuild?: boolean
  ): (...args: Parameters<T>) => void;
}

declare module 'react-native-reanimated/lib/module/hook/utils' {
  export function buildDependencies(
    dependencies: ReadonlyArray<unknown> | undefined,
    handlers: Record<string, unknown>
  ): unknown[];
  export function areDependenciesEqual(nextDeps: unknown[], prevDeps: unknown[]): boolean;
}

declare module 'react-native-reanimated/lib/module/common' {
  export const IS_JEST: boolean;
  export const IS_WEB: boolean;
}
