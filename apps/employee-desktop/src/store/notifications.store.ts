import { create } from 'zustand';
import type { AppNotification } from '../types/domain';

interface NotificationsState {
  items: AppNotification[];
  unreadCount: number;
  push: (notification: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  items: [],
  unreadCount: 0,

  push(notification) {
    const entry: AppNotification = {
      ...notification,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      read: false,
    };
    set((state) => ({
      items: [entry, ...state.items].slice(0, 50),
      unreadCount: state.unreadCount + 1,
    }));
  },

  markRead(id) {
    set((state) => {
      const items = state.items.map((item) => (item.id === id ? { ...item, read: true } : item));
      return { items, unreadCount: items.filter((item) => !item.read).length };
    });
  },

  markAllRead() {
    set((state) => ({
      items: state.items.map((item) => ({ ...item, read: true })),
      unreadCount: 0,
    }));
  },
}));
