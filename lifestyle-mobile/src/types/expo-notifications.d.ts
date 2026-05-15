declare module 'expo-notifications' {
  export const AndroidImportance: {
    DEFAULT: string;
    HIGH: string;
    LOW: string;
    MAX: string;
    MIN: string;
    NONE: string;
    UNKNOWN: string;
  };

  export const AndroidNotificationVisibility: {
    PRIVATE: number;
    PUBLIC: number;
    SECRET: number;
    UNKNOWN: number;
  };

  export interface NotificationChannelInput {
    name: string;
    importance: string;
    lockscreenVisibility?: number;
    showBadge?: boolean;
    sound?: string | null;
    vibrationPattern?: number[] | null;
    enableVibrate?: boolean;
  }

  export interface NotificationContent {
    title?: string;
    body?: string;
    sound?: boolean | string;
    data?: Record<string, unknown>;
  }

  export interface NotificationTrigger {
    channelId?: string;
  }

  export interface NotificationRequest {
    identifier?: string;
    content: NotificationContent;
    trigger: NotificationTrigger | null;
  }

  export interface PermissionResponse {
    status: 'granted' | 'denied' | 'undetermined';
  }

  export function scheduleNotificationAsync(request: NotificationRequest): Promise<string>;
  export function dismissNotificationAsync(identifier: string): Promise<void>;
  export function requestPermissionsAsync(): Promise<PermissionResponse>;
  export function setNotificationChannelAsync(
    channelId: string,
    channel: NotificationChannelInput
  ): Promise<void>;
}
