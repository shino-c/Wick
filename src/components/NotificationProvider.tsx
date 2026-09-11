import React, { createContext, useContext, useMemo, useState } from 'react';

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  time: string;
  read: boolean;
};

type NotificationsContextValue = {
  notifications: AppNotification[];
  hasUnread: boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const initialNotifications: AppNotification[] = [
  { id: 'welcome', title: 'Welcome to Wick', body: 'Start by adding your first task or completing a recovery session.', time: '2h ago', read: false },
  { id: 'recovery', title: 'Daily Recovery Available', body: 'Your personalized recovery plan is ready. Take a gentle pause today.', time: '5h ago', read: false },
];

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const value = useMemo(() => ({
    notifications,
    hasUnread: notifications.some((notification) => !notification.read),
    markRead: (id: string) => setNotifications((current) => current.map((notification) => notification.id === id ? { ...notification, read: true } : notification)),
    markAllRead: () => setNotifications((current) => current.map((notification) => ({ ...notification, read: true }))),
  }), [notifications]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications must be used inside NotificationProvider');
  return context;
}
