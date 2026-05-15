declare module 'expo-widgets' {
  export function createWidget<Props>(name: string, layout: (props: Props, environment: unknown) => unknown): unknown;
  export function createLiveActivity<Props>(name: string, layout: (props: Props, environment: unknown) => unknown): unknown;
}
